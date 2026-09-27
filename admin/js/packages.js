/* placeholder — replaced by the packages module */
(function () {
  "use strict";
  Admin.registerView("packages", {
    render: function (el) {
      el.innerHTML = Admin.h.pageHead({ title: "Packages" }) + Admin.h.empty("info", "Coming soon", "This view is being built.");
    }
  });
})();
