// Demo Shop: a cart counter and a newsletter sign-up.

var count = 0;
var badge = document.getElementById("cart-count");
document.querySelectorAll(".cartBtn").forEach(function (button) {
  button.addEventListener("click", function () {
    count += 1;
    badge.textContent = String(count);
    badge.classList.add("bump");
    setTimeout(function () { badge.classList.remove("bump"); }, 250);
  });
});

// Stands in for the newsletter API: it accepts any address and answers { ok: true }.
function subscribe(email) {
  return Promise.resolve({ ok: true, email: email });
}

document.getElementById("subscribe-form").addEventListener("submit", function (e) {
  e.preventDefault();
  var email = document.getElementById("email").value;
  var out = document.getElementById("subscribe-result");
  subscribe(email).then(function (res) {
    if (res.status === "ok") {
      out.className = "ok";
      out.textContent = "Thanks for subscribing, " + email + "!";
    } else {
      out.className = "err";
      out.textContent = "Subscription failed. Please try again later.";
    }
  });
});
