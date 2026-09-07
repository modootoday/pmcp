/**
 * Narrowing the skills table by typing.
 *
 * A static asset rather than an inline script: a sibling brand shipped this
 * inline, its content-security-policy dropped it, and the page looked correct
 * while the control did nothing. pmcp.build sends no policy today, which is a
 * reason to write it this way now rather than a reason not to.
 *
 * Progressive enhancement. Every row is server-rendered, so a crawler and a
 * reader without scripting get the whole list; the control is emitted hidden
 * and revealed here, and the plain count line it replaces is hidden here too.
 */
(function () {
  var input = document.getElementById("skills-filter");
  var table = document.getElementById("skills-table");
  if (!input || !table) return;

  var count = document.getElementById("skills-count");
  var rows = Array.prototype.slice.call(table.tBodies[0].rows);
  // The count's own text, so the generator has one less thing to keep in step
  // with this file.
  var resting = count ? count.textContent : "";

  input.hidden = false;
  var label = document.querySelector('label[for="skills-filter"]');
  if (label) label.hidden = false;

  input.addEventListener("input", function () {
    var query = input.value.trim().toLowerCase();
    var shown = 0;
    for (var at = 0; at < rows.length; at += 1) {
      var row = rows[at];
      // The whole row, so a search for "dom" finds jsdom and happy-dom through
      // their targets as well as their names.
      var hit =
        query === "" || row.textContent.toLowerCase().indexOf(query) >= 0;
      row.hidden = !hit;
      if (hit) shown += 1;
    }
    if (!count) return;
    count.textContent =
      query === ""
        ? resting
        : shown +
          (shown === 1 ? " skill matches" : " skills match") +
          " “" +
          input.value.trim() +
          "”";
  });
})();
