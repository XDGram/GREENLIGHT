// Demo Shop: a cart counter and a newsletter sign-up.

var count = 0;
document.getElementById("add-item").addEventListener("click", function () {
  count += 1;
  document.getElementById("cart-count").textContent = String(count);
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
    if (res && res.ok) {
      out.className = "ok";
      out.textContent = "Thanks for subscribing, " + email + "!";
    } else {
      out.className = "err";
      out.textContent = "Subscription failed. Please try again later.";
    }
  });
});
