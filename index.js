const fs = require("fs");
const puppeteer = require("puppeteer");
const compareImages = require("resemblejs/compareImages");
const fx = require("mz/fs");
const gm = require("gm");
var path = require("path");
var glob = require("glob");
const { exec } = require("child_process");
const dotenv = require("dotenv");
const compress_images = require("compress-images");

dotenv.config({ path: path.join(__dirname, ".env") });

const templatex = require("./sites/" + process.env.TEMPLATE + ".json");
const PRODUCTION_URL = templatex[0].config.PRODUCTION_URL,
  STAGING_URL = templatex[0].config.STAGING_URL,
  COOKIE_PRODUCTION = templatex[0].config.COOKIE_PRODUCTION,
  COOKIE_STAGING = templatex[0].config.COOKIE_STAGING,
  COOKIE_ONE = templatex[0].config.COOKIE_ONE,
  ISCOOKIESET = templatex[0].config.ISCOOKIESET,
  pages = templatex[0].pages;

async function deleteOldFiles() {
  if (fs.existsSync(process.env.IMAGES_FOLDER)) {
    fs.rmSync(process.env.IMAGES_FOLDER, { recursive: true });
  }
  if (fs.existsSync(process.env.COMPFILE)) {
    fs.rmSync(process.env.COMPFILE, { recursive: true });
  }
  if (fs.existsSync(process.env.SS_FOLDER)) {
    fs.rmSync(process.env.SS_FOLDER, { recursive: true });
  }
  if (fs.existsSync(process.env.PDF_FOLDER)) {
    fs.rmSync(process.env.PDF_FOLDER, { recursive: true });
  }
}

function getName(arreglo) {
  var name = "";
  if (arreglo[1] == "") {
    name = "hp";
  } else {
    var filtered = arreglo.filter(function (el) {
      return el != "";
    });
    name = filtered.join("_");
  }
  return name;
}

async function captureMultipleScreenshots(phase, device) {
  var phase_url = phase == "production" ? PRODUCTION_URL : STAGING_URL;
  var cookie = phase == "production" ? COOKIE_PRODUCTION : COOKIE_STAGING;

  var fullpath = process.env.IMAGES_FOLDER;
  let browser = null;

  if (!fs.existsSync(fullpath)) {
    fs.mkdirSync(fullpath, { recursive: true });
  }
  if (!fs.existsSync(process.env.JS_FOLDER)) {
    fs.mkdirSync(process.env.JS_FOLDER, { recursive: true });
  }
  try {
    // launch headless Chromium browser
    browser = await puppeteer.launch({
      headless: true,
      LANGUAGE: process.env.LANGUAGE,
      slowMo: 200,
    });
    // create new page object
    const page = await browser.newPage();
    if (ISCOOKIESET) {
      const cookies = [
        {
          name: COOKIE_ONE,
          value: "rendered",
          domain: cookie,
        },
      ];
      await page.setCookie(...cookies);
    }
    await page.setDefaultNavigationTimeout(process.env.TIMEOUT);
    // set viewport width and height
    if (device == "desktop") {
      var w = parseInt(process.env.DESKTOP_WIDTH),
        h = parseInt(process.env.DESKTOP_HEIGHT);
    } else {
      var w = parseInt(process.env.MOBILE_WIDTH),
        h = parseInt(process.env.MOBILE_HEIGHT);
    }
    await page.setViewport({ width: w, height: h });

    for (const { id, url } of pages) {
      var arreglo = url.split("/");
      var name = getName(arreglo);
      await page.goto(phase_url + url);
      await page.screenshot({
        path: `${fullpath}/${id}-${phase}-${device}-${name}.${process.env.IMAGE_EXT}`,
        fullPage: true,
      });
      console.log(
        `CMSS: ${fullpath}/${id}-${phase}-${device}-${name}.${process.env.IMAGE_EXT}`
      );
    }
  } catch (err) {
    console.log(`❌ CMSS Error: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log(`\n🎉 ${pages.length} screenshots captured.\n`);
  }
}

async function getDiff(device) {
  var path_prod = process.env.PATH_PRODUCTION;
  var path_stag = process.env.PATH_STAGING;

  if (!fs.existsSync(process.env.IMAGES_FOLDER)) {
    fs.mkdirSync(process.env.IMAGES_FOLDER, { recursive: true });
  }

  const options = {
    output: {
      errorColor: { red: 255, green: 0, blue: 255 },
      errorType: "movement",
      transparency: 1,
      largeImageThreshold: 1200,
      useCrossOrigin: false,
      outputDiff: true,
    },
    scaleToSameSize: true,
    ignore: "less",
  };

  for (const { id, url } of pages) {
    var arreglo = url.split("/");
    var name = getName(arreglo);
    var comparison =
      id + "-compare-" + device + "-" + name + "." + process.env.IMAGE_EXT;
    var comparison_compress =
      id +
      "-compare-" +
      device +
      "-" +
      name +
      "-compress." +
      process.env.IMAGE_EXT;
    var production =
      id +
      "-" +
      path_prod +
      "-" +
      device +
      "-" +
      name +
      "." +
      process.env.IMAGE_EXT;
    var staging =
      id +
      "-" +
      path_stag +
      "-" +
      device +
      "-" +
      name +
      "." +
      process.env.IMAGE_EXT;

    var production_compress =
      id +
      "-" +
      path_prod +
      "-" +
      device +
      "-" +
      name +
      "-compress." +
      process.env.IMAGE_EXT;
    var staging_compress =
      id +
      "-" +
      path_stag +
      "-" +
      device +
      "-" +
      name +
      "-compress." +
      process.env.IMAGE_EXT;

    const data = await compareImages(
      await fx.readFile(process.env.IMAGES_FOLDER + "/" + production),
      await fx.readFile(process.env.IMAGES_FOLDER + "/" + staging),
      options
    );
    await fx.writeFile(
      `${process.env.IMAGES_FOLDER}/${id}-compare-${device}-${name}.${process.env.IMAGE_EXT}`,
      data.getBuffer()
    );
    console.log(
      `getDiff: ${process.env.IMAGES_FOLDER}/${id}-compare-${device}-${name}.${process.env.IMAGE_EXT}`
    );
    generarHTML(
      comparison_compress,
      production_compress,
      staging_compress,
      device
    );
  }
}

async function generarHTML(comparison, production, staging, device) {
  if (!fs.existsSync(process.env.COMPFILE)) {
    fs.mkdirSync(process.env.COMPFILE, { recursive: true });
  }
  if (!fs.existsSync(process.env.HTML_FOLDER)) {
    fs.mkdirSync(process.env.HTML_FOLDER, { recursive: true });
  }
  if (!fs.existsSync(process.env.JS_FOLDER)) {
    fs.mkdirSync(process.env.JS_FOLDER, { recursive: true });
  }
  if (!fs.existsSync(process.env.CSS_FOLDER)) {
    fs.mkdirSync(process.env.CSS_FOLDER, { recursive: true });
    // File destination.txt will be created or overwritten by default.
    fs.copyFile(
      "templates/style.css",
      process.env.CSS_FOLDER + "/style.css",
      (err) => {
        if (err) throw err;
        console.log("style.css was copied");
      }
    );
    fs.copyFile(
      "templates/app.js",
      process.env.JS_FOLDER + "/app.js",
      (err) => {
        if (err) throw err;
        console.log("style.css was copied");
      }
    );
  }
  var template = path.join(__dirname, "templates/templatehtml.html");

  var prefilename = path.join(
    __dirname,
    process.env.HTML_FOLDER + "/" + comparison
  );
  var filename = prefilename.replace(
    "-compress." + process.env.IMAGE_EXT,
    ".html"
  );
  var templateHtml = fs.readFileSync(template, "utf8");

  var title = comparison.replace("." + process.env.IMAGE_EXT, "");
  var _comparison = path.join("../images/", comparison);
  var _production = path.join("../images/", production);
  var _staging = path.join("../images/", staging);
  templateHtml = templateHtml.replace("{{title}}", title);
  templateHtml = templateHtml.replace("{{comparison}}", _comparison);
  templateHtml = templateHtml.replace("{{production}}", _production);
  templateHtml = templateHtml.replace("{{staging}}", _staging);
  templateHtml = templateHtml.replace("{{device}}", device);
  await fx.writeFile(`${filename}`, templateHtml);
}

async function comprimirComparison(inputPath, ouputPath) {
  (INPUT_path_to_your_images =
    inputPath + "/**/!(*-compress)." + process.env.IMAGE_EXT),
    (OUTPUT_path = ouputPath + "/");

  compress_images(
    INPUT_path_to_your_images,
    OUTPUT_path,
    { compress_force: true, statistic: false, autoupdate: true },
    false,
    { jpg: { engine: false, command: false } },
    {
      png: {
        engine: "pngquant",
        command: [
          "--quality=20-50",
          "--ext=-compress." + process.env.IMAGE_EXT,
          "--force",
        ],
      },
    },
    { svg: { engine: false, command: false } },
    { gif: { engine: false, command: false } },
    function (err, completed, statistic) {
      if (err === null) {
        fs.unlink(statistic.input, (err) => {
          if (err) throw err;
          console.log("successfully compressed and deleted " + statistic.input);
        });
      }
    }
  );
}

async function buildMenu() {
  var desktopList = "";
  var mobileList = "";
  for (const { id, url } of pages) {
    var arreglo = url.split("/");
    var name = getName(arreglo);
    if (process.env.DESKTOP) {
      desktopList += `<li><a class="menulink" href='html/${id}-compare-desktop-${name}.html' 
      data-productionlink="${PRODUCTION_URL}${url}"
      data-staginglink="${STAGING_URL}${url}"
      data-page="${url}"
      >${name}</a></li>`;
    }
    if (process.env.MOBILE) {
      mobileList += `<li><a class="menulink" href='html/${id}-compare-mobile-${name}.html' 
      data-productionlink="${PRODUCTION_URL}${url}"
      data-staginglink="${STAGING_URL}${url}"
      data-page="${url}"
      >${name}</a></li>`;
    }
  }

  var indexFile = path.join(__dirname, "templates/index.html");
  var indexHtml = fs.readFileSync(indexFile, "utf8");
  indexHtml = indexHtml.replace("{{MENUDESKTOP}}", desktopList);
  indexHtml = indexHtml.replace("{{MENUMOBILE}}", mobileList);

  await fx.writeFile(process.env.COMPFILE + "/index.html", indexHtml);
}

async function init() {
  await deleteOldFiles();
  if (process.env.DESKTOP) {
    await captureMultipleScreenshots("production", "desktop");
    await captureMultipleScreenshots("staging", "desktop");
    await getDiff("desktop");
  }
  if (process.env.MOBILE) {
    await captureMultipleScreenshots("production", "mobile");
    await captureMultipleScreenshots("staging", "mobile");
    await getDiff("mobile");
  }
  await buildMenu();
  comprimirComparison(
    process.env.COMPFILE + "/images",
    process.env.COMPFILE + "/images"
  );
}
init();
