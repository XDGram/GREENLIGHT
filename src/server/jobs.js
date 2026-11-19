// Background certification jobs: bounded concurrency, bounded queue, one active
// job per project, persisted status. A job interrupted by a server restart is
// marked failed (interrupted_by_restart) and never re-run automatically: every
// run spends real credits, so only a person may start another.

import { randomUUID } from "node:crypto";
import { GreenlightError, errorBody } from "../cli/errors.js";
import { JOB_STATUS, SCHEMAS } from "./models.js";
import { runCertification } from "./certify.js";

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

  /** Mark jobs left running/queued by a previous process as failed. */
  async recover() {
    for (const j of await this.store.listJobs()) {
      if (j.status === JOB_STATUS.RUNNING || j.status === JOB_STATUS.QUEUED) {
        await this.store.putJob({ ...j, status: JOB_STATUS.FAILED, finishedAt: this.deps.now().toISOString(), error: errorBody("interrupted", "The server stopped while this job was pending or running; it was not re-run.") });
      }
    }
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
