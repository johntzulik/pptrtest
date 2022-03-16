const fs = require("fs");
const puppeteer = require("puppeteer");
const compareImages = require("resemblejs/compareImages");
const fx = require("mz/fs");
const gm = require('gm');
const pdf = require('html-pdf');
var path = require('path')


const client = "images";
const production = "";
const staging = "";
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
    var cookie = phase == "production" ? 'yourspca.org' : 'bufny19.wpengine.com';
    //var fullpath = client + "/" + phase;
    var fullpath = client;
    let browser = null;

    if (!fs.existsSync(fullpath)) {
        fs.mkdirSync(fullpath, { recursive: true });
    }
    
    try {
        const cookies = [{
            'name': 'lb_2112_sustainer_monthly_shelter_guardians',
            'value': 'true',
            'domain': cookie
          }];
        // launch headless Chromium browser
        browser = await puppeteer.launch({headless: true,});
        // create new page object
        const page = await browser.newPage();
        await page.setCookie(...cookies);
        page.waitForTimeout(1000)
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
            //await page.screenshot({ path: `${fullpath}/${id}-${device}-${name}.png`, fullPage: true });
            await page.screenshot({ path: `${fullpath}/${id}-${phase}-${device}-${name}.png`, fullPage: true });
            //console.log(`${fullpath}/${id}-${device}-${name}.png`);
            console.log(`${fullpath}/${id}-${phase}-${device}-${name}.png`);
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
    var path_prod = "production";
    var path_stag = "staging";
    //var path_prod = client + "/production";
    //var path_stag = client + "/staging";
    var output = client;

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
            outputDiff: true,
        },
        scaleToSameSize: true,
        ignore: "less"
    };

    for (const { id, url } of pages) {
        var arreglo = url.split("/");
        var name = getName(arreglo)
        var comparison =  id + '-compare-' + device + '-' + name + ".png"
        var production =  id + '-' +path_prod + '-' + device + '-' + name + ".png"
        var staging = id + '-' + path_stag + '-' + device + '-' + name + ".png"

        const data = await compareImages(
            await fx.readFile( client + '/'+ production ),
            await fx.readFile( client + '/'+ staging ),
            options
        );
        await fx.writeFile(`${client}/${id}-compare-${device}-${name}.png`, data.getBuffer());
        console.log(`${client}/${id}-compare-${device}-${name}.png`);
        
        generarHTML(comparison, production,staging)
    }
}
async function getSize(image){
    gm(image).size(function (err, value) {
        return value
        if (err) {
            console.log(err);
        }
    });
}
async function generarHTML(comparison, production,staging){

    var template = path.join(__dirname, 'templatehtml.html')
    var prefilename = path.join(__dirname, 'html/' + comparison)
    var filename =  prefilename.replace('.png', '.html')
    var templateHtml = fs.readFileSync(template, 'utf8')

    var title = comparison.replace('.png', '')
    var _comparison = path.join('../images/', comparison)
    var _production = path.join( '../images/', production)
    var _staging = path.join('../images/', staging)
    templateHtml = templateHtml.replace('{{title}}', title)
    templateHtml = templateHtml.replace('{{comparison}}', _comparison)
    templateHtml = templateHtml.replace('{{production}}', _production)
    templateHtml = templateHtml.replace('{{staging}}', _staging)
    await fx.writeFile(`${filename}`, templateHtml);
}

async function init() {
    await captureMultipleScreenshots("production", "desktop");
    await captureMultipleScreenshots("staging", "desktop");
    await getDiff("desktop");
    //await captureMultipleScreenshots("production", "mobile");
    //await captureMultipleScreenshots("staging", "mobile");
    //await getDiff("mobile");
}
init();