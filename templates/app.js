$(document).ready(function () {
  $(".menulink").click(function (e) {
    e.preventDefault();
    var url = $(this).attr("href");
    loadIframe(url);
    console.log(url);
  });

  function loadIframe(url) {
    console.log("refrescando el iframe");
    var $iframe = $("#eliframe");
    if ($iframe.length) {
      $iframe.attr("src", url);
      return false;
    }
    return true;
  }
});
