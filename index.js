const fs = require("fs");
const puppeteer = require("puppeteer");
const compareImages = require("resemblejs/compareImages");
const fx = require("mz/fs");
const gm = require('gm');
var path = require('path')
var glob = require("glob")
const {exec} = require('child_process')
const dotenv = require("dotenv");


dotenv.config({ path: path.join(__dirname, ".env") });
const pages = require("./pages.json");

async function deleteOldFiles(){
    if (fs.existsSync(process.env.IMAGES_FOLDER)) {
        fs.rmSync(process.env.IMAGES_FOLDER, { recursive: true });
    }
    if (fs.existsSync(process.env.HTML_FOLDER)) {
        fs.rmSync(process.env.HTML_FOLDER, { recursive: true });
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
        var filtered = arreglo.filter(function(el) {
            return el != "";
        });
        name = filtered.join('_');
    }
    return name;
}

async function captureMultipleScreenshots(phase, device) {
    var phase_url = phase == "production" ? process.env.PRODUCTION_URL : process.env.STAGING_URL;
    var cookie = phase == "production" ? process.env.COOKIE_PRODUCTION : process.env.COOKIE_STAGING;

    var fullpath = process.env.IMAGES_FOLDER;
    let browser = null;

    if (!fs.existsSync(fullpath)) {
        fs.mkdirSync(fullpath, { recursive: true });
    }
    
    try {
        // launch headless Chromium browser
        browser = await puppeteer.launch({headless: true,});
        // create new page object
        const page = await browser.newPage();
        if(process.env.ISCOOKIESET){
            const cookies = [{
                'name': process.env.COOKIE_NAME,
                'value': 'true',
                'domain': cookie
            }];
            await page.setCookie(...cookies);
        }
        await page.setDefaultNavigationTimeout(0);
        // set viewport width and height
        if (device == "desktop") {
            var w = 1440,h = 1080;
        } else {
            var w = 360,h = 640;
        }
        await page.setViewport({width: w,height: h,});

        for (const { id, url } of pages) {
            var arreglo = url.split("/");
            var name = getName(arreglo);
            await page.goto(phase_url + url);
            await page.screenshot({ path: `${fullpath}/${id}-${phase}-${device}-${name}.png`, fullPage: true });
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

    if (!fs.existsSync(process.env.IMAGES_FOLDER)) {
        fs.mkdirSync(process.env.IMAGES_FOLDER, { recursive: true });
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
            await fx.readFile( process.env.IMAGES_FOLDER + '/'+ production ),
            await fx.readFile( process.env.IMAGES_FOLDER + '/'+ staging ),
            options
        );
        await fx.writeFile(`${process.env.IMAGES_FOLDER}/${id}-compare-${device}-${name}.png`, data.getBuffer());
        console.log(`${process.env.IMAGES_FOLDER}/${id}-compare-${device}-${name}.png`);
        generarHTML(comparison, production,staging,device)
    }
}

async function generarHTML(comparison, production,staging, device){

    if (!fs.existsSync(process.env.HTML_FOLDER)) {
        fs.mkdirSync(process.env.HTML_FOLDER, { recursive: true });
    }
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
    templateHtml = templateHtml.replace('{{device}}', device)

    await fx.writeFile(`${filename}`, templateHtml);
}
async function ssHtml(){
    if (fs.existsSync(process.env.HTML_FOLDER)) {
        try{
            if (!fs.existsSync(process.env.PDF_FOLDER)) {
                fs.mkdirSync(process.env.PDF_FOLDER, { recursive: true });
            }
            if (!fs.existsSync(process.env.SS_FOLDER)) {
                fs.mkdirSync(process.env.SS_FOLDER, { recursive: true });
            }
            browser = await puppeteer.launch({headless: true,});
            // create new page object
            const page = await browser.newPage();
            await page.setDefaultNavigationTimeout(0);
            
            // set viewport width and height
            var w = 1440,h = 1080;

            // list all files in the directory

            let htmlFiles = glob.sync(`html/*.html`);
            for (let i = 0; i < htmlFiles.length; i++) {
                var file = htmlFiles[i];
                file = file.replace('html/','')
                await page.goto(process.env.LOCALHOST_URL + "/" + process.env.HTML_FOLDER + "/"+ file);
 
                let namePGN = file.replace('.html', '.png')
                let namePDF = file.replace('.html', '.pdf')
                let fullPNGPath =`${process.env.SS_FOLDER}/${namePGN}`
                let fullPDFPath = `${process.env.PDF_FOLDER}/${namePDF}`
                await page.screenshot({ path: `${process.env.SS_FOLDER}/${namePGN}`, fullPage: true });
                console.log(`${process.env.SS_FOLDER}/${namePGN}`);
            
                exec(`magick convert ${fullPNGPath} ${fullPDFPath}`, (err, stderr, stdout) => {
                    if (err) throw err;
                });
            }
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
        } finally {
            if (browser) {
                await browser.close();
            }
            let htmlFiles = glob.sync(`html/*.html`);
            console.log(`\n🎉 ${htmlFiles.length} PDFs captured.`);
        }
    }

}


async function init() {
    await deleteOldFiles();
    await captureMultipleScreenshots("production", "desktop");
    await captureMultipleScreenshots("staging", "desktop");
    await getDiff("desktop");
    await captureMultipleScreenshots("production", "mobile");
    await captureMultipleScreenshots("staging", "mobile");
    await getDiff("mobile");
    await ssHtml()
}
init();