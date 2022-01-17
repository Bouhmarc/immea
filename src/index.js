const {
  BaseKonnector,
  requestFactory,
  signin,
  scrape,
  saveFiles,
  log
} = require('cozy-konnector-libs')
const path = require('path');
const url = require('url');

const request = requestFactory({
  // the debug mode shows all the details about http request and responses. Very useful for
  // debugging but very verbose. That is why it is commented out by default
  //debug: true,
  // activates [cheerio](https://cheerio.js.org/) parsing on each page
  cheerio: true,
  // If cheerio is activated do not forget to deactivate json parsing (which is activated by
  // default in cozy-konnector-libs
  json: false,
  // this allows request-promise to keep cookies between requests
  jar: true
})

const baseUrl = 'https://immea-enligne.com/'
module.exports = new BaseKonnector(start)

// The start function is run by the BaseKonnector instance only when it got all the account
// information (fields). When you run this connector yourself in "standalone" mode or "dev" mode,
// the account information come from ./konnector-dev-config.json file
async function start(fields) {
  log('info', 'Authenticating ...')
  await authenticate(fields.login, fields.password)
  log('info', 'Successfully logged in')
  // The BaseKonnector instance expects a Promise as return of the function
  log('info', 'Fetching the list of documents')
  const $ = await request(
    `https://immea-enligne.com/index.php?c=document&a=mesDocuments`
  )

  log('info', 'Parsing list of documents')
  const documents = await parseDocuments($)

  // here we use the saveBills function even if what we fetch are not bills, but this is the most
  // common case in connectors
  log('info', documents)
  log('info', 'Saving data to Cozy')
  await saveFiles(documents, fields, {
    timeout: Date.now() + 300 * 1000
  })
}

// this shows authentication using the [signin function](https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#module_signin)
// even if this in another domain here, but it works as an example
function authenticate(username, password) {
  return signin({
    url: `https://immea-enligne.com/`,
    formSelector: '.form-signin',
    formData: { login: username, mdp: password, connexion: '' },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36'
    },

    // the validate function will check if the login request was a success. Every website has
    // different ways respond: http status code, error message in html ($), http redirection
    // (fullResponse.request.uri.href)...
    validate: (statusCode, $, fullResponse) => {
      if (
        fullResponse.body.includes('index.php?c=defaut&amp;a=terminersession')
      )
        return true
      else return false
    }
  })
}

// The goal of this function is to parse a html page wrapped by a cheerio instance
// and return an array of js objects which will be saved to the cozy by saveBills (https://github.com/konnectors/libs/blob/master/packages/cozy-konnector-libs/docs/api.md#savebills)
function parseDocuments($) {
  // parse les differents documents
  const docs = scrape(
    $,
    {
      title: {
        sel: 'a',
        parse: GetTitleFromText
      },
      filename: {
        sel: 'a',
        parse: normalizeFileName
      },
      fileurl: {
        sel: 'a',
        attr: 'href',
        parse: src => decodeURIComponent(`${baseUrl}${src}`)
      }, 
      subPath: {
        fn: node => decodeIDAppartement(node)
      }
    },
    '.tree ul li ul li'
  )

  return docs.map(doc => ({
    ...doc,
    // the saveBills function needs a date field
    // even if it is a little artificial here (these are not real bills)
    date: getDateFromTitle(doc.title),
    vendor: 'immea',
    metadata: {
      // it can be interesting that we add the date of import. This is not mandatory but may be
      // useful for debugging or data migration
      importDate: new Date(),
      // document version, useful for migration after change of document structure
      version: 1
    }
  }))
}

function normalizeFileName(sFileName) {
  // On remplace les caracteres inconnus (je ne sais pas a quel endroit le
  // charset doit etre defini) par une chaine vide
  sFileName = sFileName.replace('\uFFFD', '')
  return sFileName.replace(new RegExp(' ', 'g'), '_')
}

function GetTitleFromText(oTitle) {
  // Splitte le texte (nom du fichier)
  var tabSplit = oTitle.split('.')
  //Supprime le dernier element
  tabSplit.pop()

  // On renvoie tous les elements du tableau separes par '-'
  return tabSplit.join('-')
}

function getDateFromTitle(sTitle) {
  var regex1 = RegExp('([0-9]{2})-([0-9]{2})-([0-9]{4})', 'g')
  // Differents formats de chaines rencontres :
  // var str1 = 'REPARTITION DE CHARGES DU 01-01-2017 AU 31-12-2017';
  // var str1 = 'APPEL DE FONDS N°2 - 2016';
  // var str1 = 'APPEL DE FONDS 2015.PDF';
  // var str1 = 'APPEL DE FONDS - 2015.PDF';
  var array1
  // Valeur de la date par default : 01.01.Annee en cours
  var nDay = 1
  var nMonth = 1
  var nYear = new Date().getYear()

  // Gestion du format : REPARTITION DE CHARGES DU 01-01-2017 AU 31-12-2017
  array1 = regex1.exec(sTitle)
  if (array1 != null && array1.length > 0) {
    nDay = array1[1]
    nMonth = array1[2]
    nYear = array1[3]
  } else {
    // Gestion du format : APPEL DE FONDS N  2 - 2016
    regex1 = RegExp('([0-9]{1}) - ([0-9]{4})', 'g')
    array1 = regex1.exec(sTitle)
    if (array1 != null && array1.length >= 3) {
      nMonth = Math.max((array1[1] - 1) * 6, 1)
      nYear = array1[2]
    } else {
      // Gestion du format : APPEL DE FONDS 2015 et APPEL DE FONDS - 2015
      regex1 = RegExp('([0-9]{4})', 'g')
      array1 = regex1.exec(sTitle)
      if (array1 != null && array1.length > 0) {
        nYear = array1[0]
      } else {
        // Pas de date trouvee, par defaut sera lae premier janvier de l'annee en cours
        log('info', 'pas de date trouvee')
      }
    }
  }

  return new Date(nYear + '-' + nMonth + '-' + nDay)
}

function decodeIDAppartement(oNode)
{

  var sSousRepertoire = ''
  var sNomRepertoireCourant = ''
  var oParent = oNode[0].parent

  while (oParent)
  {

    if (oParent.attribs && oParent.attribs.class == 'directory')
    {
      // C'est un répertoire
      // on prend le deux noeuds précédents, le dernier fils et sa donnée
      sNomRepertoireCourant = oParent.prev.prev.lastChild.data

      sNomRepertoireCourant = sNomRepertoireCourant.trim();
      sNomRepertoireCourant = sNomRepertoireCourant.replace("/","-")
      sSousRepertoire = path.join(sNomRepertoireCourant, sSousRepertoire)
     

      // Remonte sur le parent et continue
      oParent = oParent.parent
      continue
    }
    
    if (oParent.attribs && (oParent.attribs.class == 'collapse' || oParent.attribs.class == 'show'))
    {

      sNomRepertoireCourant = oParent.prev.prev.children[1].children[1].children[1].data
      sNomRepertoireCourant = sNomRepertoireCourant.trim();
      sNomRepertoireCourant = sNomRepertoireCourant.replace("/","-")

      sSousRepertoire = path.join(sNomRepertoireCourant, sSousRepertoire)
      break; 
    }

    // On remonte sur le parent
    oParent = oParent.parent
    
  }

  return sSousRepertoire

  // Supprime le \n





  // parse l'url
  var q = url.parse(sURL, true);
  // récupère les paramètres
  var qs = q.query;
  var vObjet = JSON.parse(qs.p1)
  return vObjet





}