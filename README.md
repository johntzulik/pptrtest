# Puppenpare
## _You can compare 2 sites production vs staging_

[![N|Solid](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)

Puppenpare tries to compare 2 sites easily, using puppeteer and node

You must have node 18 at least

## Use node ^18
```sh
nvm use 18
npm install
```

This project run with
[vscode](https://code.visualstudio.com/)
  and a plugin called [LiveServer](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)

Please turn on the plugin clicking on Go Live button at the bottom of your VS code

![N|Solid](https://i.stack.imgur.com/7HTSE.png)

## The URL that give you the LiveServer copy and paste into .env file mostly is http://127.0.0.1:5500 


You need to load as json format the different url's that you want to compare into file 

```sh
pages.json
```
```sh
[
  {
    "id": "01",
    "url": "/inspirational/"
  }
]
```

For the .env file you can customize all the parameters 

Try to DON'T touch the folders

You can change the PRODUCTION_URL and STAGING_URL

You can set true or false the ISCOOKIESET, this allow to set a cookie for a LB

To set
```sh
HTML_FOLDER= "src"
CSS_FOLDER = "src/css"
IMAGES_FOLDER = "src/images"
SS_FOLDER = "ss"
PDF_FOLDER = "pdf_comparative_files"

PRODUCTION_URL = "https://production.com/"
STAGING_URL = "https://staging.production.com/"

COOKIE_PRODUCTION = 'production.com'
COOKIE_STAGING = 'staging.production.com'
COOKIE_NAME = ""
ISCOOKIESET = false

LOCALHOST_URL = "http://127.0.0.1:5500" 
```
After all this configurations you can run the project

Open a terminal and you can run as:

```sh
node index.js
```

Some folder will be created, and you can find in the src folder all the html generated by the puppenpare


You need to have installed magick 
https://imagemagick.org/script/download.php
if you won't make the PDF please comment the next line 
```sh
//await ssHtml()
```


## License

MIT

**Free Software, Hell Yeah!**


## Authors

Github [@johntzulik](https://github.com/johntzulik)

Linkedin [@johntzulik](https://www.linkedin.com/in/johntzulik/)

Twitter [@johntzulik](https://twitter.com/johntzulik)

Medium [Blog](https://johntzulik.medium.com/)

Tiktok [@johntzulik](https://www.tiktok.com/@johntzulik)

Working on [200response.mx](https://200response.mx/)