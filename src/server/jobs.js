// Background certification jobs: bounded concurrency, bounded queue, one active
// job per project, persisted status. A job interrupted by a server restart is
// marked failed (interrupted_by_restart) and never re-run automatically: every
// run spends real credits, so only a person may start another.

import { randomUUID } from "node:crypto";
import { GreenlightError, errorBody } from "../cli/errors.js";
import { JOB_STATUS, SCHEMAS } from "./models.js";
import { runCertification, certificationRunId } from "./certify.js";

export class JobRunner {
  constructor({ store, config, deps, log = () => {} }) {
    this.store = store;
    this.config = config;
    this.deps = deps;
    this.log = log;
    this.queue = [];
    this.running = new Set();
    this.idleWaiters = [];
  }

  /**
   * Jobs a previous process left queued or running. If the run's record was
   * already committed (crash between the record and the job update), the job is
   * completed from it; otherwise it is marked failed. Nothing is re-run.
   */
  async recover({ olderThanMs = null } = {}) {
    const cutoff = olderThanMs === null ? null : this.deps.now().getTime() - olderThanMs;
    for (const j of await this.store.listJobs({ statuses: [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING] })) {
      if (j.status !== JOB_STATUS.RUNNING && j.status !== JOB_STATUS.QUEUED) continue;
      if (cutoff !== null && Date.parse(j.createdAt) > cutoff) continue; // may still be running elsewhere
      const finishedAt = this.deps.now().toISOString();
      const record = j.status === JOB_STATUS.RUNNING ? await this.#recordForJob(j) : null;
      if (record) {
        await this.store.putJob({ ...j, status: JOB_STATUS.SUCCEEDED, recordId: record.id, outcome: record.certified ? "certified" : `not_certified:${record.status}`, finishedAt });
      } else {
        await this.store.putJob({ ...j, status: JOB_STATUS.FAILED, finishedAt, error: errorBody("interrupted", "The server stopped while this job was pending or running; it was not re-run.") });
      }
    }
  }

  async #recordForJob(job) {
    for (const r of await this.store.listRecords(job.projectId)) {
      if (r.execution?.runId === certificationRunId(job.id)) return r;
    }
    return null;
  }

  activeFor(projectId) {
    return [...this.queue, ...this.running].some((j) => j.projectId === projectId);
  }

  async submit({ projectId, version, request, requestedBy }) {
    if (this.activeFor(projectId)) throw new GreenlightError("job_limit_reached", "A certification for this project is already queued or running.");
    if (this.queue.length >= this.config.maxQueuedJobs) throw new GreenlightError("job_limit_reached", "Too many certification jobs are queued.");
    const job = {
      schema: SCHEMAS.job,
      id: `job_${randomUUID().replace(/-/g, "")}`,
      kind: "certification",
      projectId,
      version,
      status: JOB_STATUS.QUEUED,
      request,
      requestedBy,
      createdAt: this.deps.now().toISOString(),
      startedAt: null,
      finishedAt: null,
      recordId: null,
      outcome: null,
      error: null,
    };
    await this.store.putJob(job);
    this.queue.push(job);
    this.pump();
    return job;
  }

  pump() {
    while (this.running.size < this.config.maxConcurrentJobs && this.queue.length) {
      const job = this.queue.shift();
      this.running.add(job);
      this.execute(job).finally(() => {
        this.running.delete(job);
        this.pump();
        if (!this.running.size && !this.queue.length) for (const w of this.idleWaiters.splice(0)) w();
      });
    }
  }

  async execute(job) {
    let current = { ...job, status: JOB_STATUS.RUNNING, startedAt: this.deps.now().toISOString() };
    await this.store.putJob(current);
    try {
      const { record, outcome } = await runCertification({ store: this.store, job: current, config: this.config, deps: this.deps });
      current = { ...current, status: JOB_STATUS.SUCCEEDED, recordId: record.id, outcome, finishedAt: this.deps.now().toISOString() };
    } catch (err) {
      const e = err instanceof GreenlightError ? errorBody(err.code, err.message, err.details) : errorBody("internal_error", "Certification failed unexpectedly.");
      if (!(err instanceof GreenlightError)) this.log({ event: "job_error", jobId: job.id, error: String(err?.stack ?? err) });
      current = { ...current, status: JOB_STATUS.FAILED, error: e, finishedAt: this.deps.now().toISOString() };
    }
    await this.store.putJob(current);
    return current;
  }

  /** Resolves when no job is queued or running (tests, graceful shutdown). */
  idle() {
    if (!this.running.size && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }
}
