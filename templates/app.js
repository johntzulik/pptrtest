$(document).ready(function () {
  $(".menulink").click(function (e) {
    e.preventDefault();
    var url = $(this).attr("href");
    var prodlink = $(this).attr("data-productionlink");
    var staglink = $(this).attr("data-staginglink");
    var page = $(this).attr("data-page");
    console.log(prodlink);
    $("#produtionlink").attr("href", prodlink);
    $("#staginglink").attr("href", staglink);
    $("#produtionlink").text("Production Link");
    $("#staginglink").text("Staging Link");

    $("#page").text(page);
    loadIframe(url);
    //console.log(url);
  });

  function loadIframe(url) {
    //console.log("refrescando el iframe");
    var $iframe = $("#eliframe");
    if ($iframe.length) {
      $iframe.attr("src", url);
      return false;
    }
    return true;
  }
});
