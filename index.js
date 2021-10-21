const fs = require("fs");
const puppeteer = require("puppeteer");
const compareImages = require("resemblejs/compareImages");
const fx = require("mz/fs");


const client = "images";
const production = "https://www.esterigen.com";
const staging = "https://esterigendev.200response.mx";
const pages = require("./pages.json");


function getName(arreglo) {
    var name = "";
    if (arreglo[1] == "") {
        name = "hp";
    } else {
        var filtered = arreglo.filter(function(el) {
            return el != "";
        });
        name = filtered.join('_');
    }
    return name;
}

async function captureMultipleScreenshots(phase, device) {
    var phase_url = phase == "production" ? production : staging;
    var fullpath = client + "/" + phase;
    let browser = null;

    if (!fs.existsSync(fullpath)) {
        fs.mkdirSync(fullpath, { recursive: true });
    }
    
    try {
        // launch headless Chromium browser
        browser = await puppeteer.launch({headless: true,});
        // create new page object
        const page = await browser.newPage();
        // set viewport width and height
        if (device == "desktop") {
            var w = 1440,h = 1080;
        } else {
            var w = 360,h = 640;
        }

        await page.setViewport({width: w,height: h,});

        for (const { id, url }
            of pages) {
            var arreglo = url.split("/");
            var name = getName(arreglo);
            await page.goto(phase_url + url);
            await page.screenshot({ path: `${fullpath}/${id}-${device}-${name}.png`, fullPage: true });
            console.log(`${fullpath}/${id}-${device}-${name}.png`);
        }
    } catch (err) {
        console.log(`❌ Error: ${err.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
        console.log(`\n🎉 ${pages.length} screenshots captured.`);
    }
}

async function getDiff(device) {
    var path_prod = client + "/production";
    var path_stag = client + "/staging";
    var output = client + "/compare";

    if (!fs.existsSync(output)) {
        fs.mkdirSync(output, { recursive: true });
    }

    const options = {
        output: {
            errorColor: {red: 255,green: 0,blue: 255},
            errorType: "movement",
            transparency: 1,
            largeImageThreshold: 1200,
            useCrossOrigin: false,
            outputDiff: true
        },
        scaleToSameSize: true,
        ignore: "antialiasing"
    };

    for (const { id, url }
        of pages) {
        var arreglo = url.split("/");
        var name = getName(arreglo)
        console.log(path_prod + "/" + id + "-" + device + "-" + name + ".png")
        console.log(path_stag + "/" + id + "-" + device + "-" + name + ".png")
        const data = await compareImages(
            await fx.readFile(path_prod + "/" + id + "-" + device + "-" + name + ".png"),
            await fx.readFile(path_stag + "/" + id + "-" + device + "-" + name + ".png"),
            options
        );
        await fx.writeFile(`${output}/${id}-${device}-${name}.png`, data.getBuffer());
    }
}

async function init() {
    await captureMultipleScreenshots("production", "desktop");
    await captureMultipleScreenshots("staging", "desktop");
    await getDiff("desktop");
    await captureMultipleScreenshots("production", "mobile");
    await captureMultipleScreenshots("staging", "mobile");
    await getDiff("mobile");
}
init();