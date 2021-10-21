# Como usar Puppeteer 
## _para comparar sitios (dev vs prod)_

[![N|Solid](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)](https://cdn-images-1.medium.com/max/2400/1*jYzSJ-aEvzhFvfq_6DQdmw.png)

pptrtest unicamente pretende apoyar en comparar dos sitios de una manera rapida y eficaz.
Utilizando herramientas como node y puppeteer

unicamente debes descargar y en linea de consola poner:

```sh
npm install
```

y para correr simplemente:

```sh
npm run dev
```

en la consola aparecera algo como esto:

```sh
 % npm run dev
> pptrtest@1.0.0 dev /Users/tuuser/tufolder/pptrtest
> node index.js

images/production/01-desktop-hp.png
images/production/02-desktop-sobre-nosotros.png

🎉 10 screenshots captured.
images/staging/01-desktop-hp.png
images/staging/02-desktop-sobre-nosotros.png

🎉 10 screenshots captured.
images/production/01-desktop-hp.png
images/staging/01-desktop-hp.png
images/production/02-desktop-sobre-nosotros.png
images/staging/02-desktop-sobre-nosotros.png

🎉 10 screenshots captured.
images/staging/01-mobile-hp.png
images/staging/02-mobile-sobre-nosotros.png

🎉 10 screenshots captured.
images/production/01-mobile-hp.png
images/staging/01-mobile-hp.png
```

## License

MIT

**Free Software, Hell Yeah!**

