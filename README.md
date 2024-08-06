# PuppyCompare

## _You can compare 2 sites production vs staging_

[![N|Solid](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)

PuppyCompare tries to compare 2 sites easily, using puppeteer and node

You need to [install canvas](https://github.com/Automattic/node-canvas#installation)
| OS | Command |
|-----:|-----------|
|OSX|`brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman`|

You must use node 20

## Use node ^20

```sh
nvm use 20
npm install
```

Before you start, you need to set the client on .env

```sh
TEMPLATE=CLIENT
```

You need to load as json format the different url's that you want to compare into file

```sh
sites/CLIENT.json
```

This "client" is "example"
We need to configure some variables

```sh
[
  {
    "config": {
      "PRODUCTION_URL": "https://example.org",
      "STAGING_URL": "http://example.wpengine.com",
      "COOKIE_PRODUCTION": "example.org",
      "COOKIE_STAGING": "example.wpengine.com",
      "COOKIE_ONE": "",
      "ISCOOKIESET": "false"
    },
    "pages": [
      {
        "id": "001",
        "url": "/"
      },
  }
]
```

Try to DON'T touch the folders

Open a terminal and you can run as:

```sh
node index.js
```

Now we are working with:
Node 20
npm 10
puppeteer 22
resemblejs 5
compress-images 2

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
