# MoonBoard 2024

Projet autonome pour une MoonBoard 2024 avec :

- grille **11 × 18**
- **198 LEDs**
- interface web statique
- connexion Bluetooth Web Bluetooth vers Arduino Nano ESP32
- création et sélection de blocs
- import / export JSON
- sauvegarde complète
- positionnement réglable de la grille sur la photo

## Structure

```text
moonboard-2024/
├── index.html
├── style.css
├── app.js
├── .nojekyll
├── README.md
├── assets/
│   ├── moonboard_2024.jpg
│   └── moonboard_2024_back.jpg
└── arduino/
    └── moonboard_2024.ino
```

## GitHub Pages

Le site est volontairement sans framework ni serveur : GitHub Pages peut publier directement des fichiers HTML/CSS/JavaScript depuis un dépôt. `index.html` doit être dans la racine de la source publiée.

1. Créer un nouveau dépôt GitHub.
2. Mettre tous les fichiers de ce dossier dans le dépôt.
3. Dans **Settings → Pages**, choisir la branche `main` et la racine `/`.
4. Ouvrir l'URL GitHub Pages du dépôt.

## Bluetooth

Le navigateur doit prendre en charge Web Bluetooth. Le bouton **Connecter l'ESP32** recherche un appareil dont le nom commence par `MoonBoard`.

UUID utilisés :

- Service : `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- RX : `6e400002-b5a3-f393-e0a9-e50e24dcca9e`

## Mapping LEDs

Le ruban est supposé commencer en **K18** et suivre :

```text
K18 → K1
J1  → J18
I18 → I1
H1  → H18
...
A18 → A1
```

Cela donne 198 positions.

## Format JSON

L'export des blocs utilise un tableau sans wrapper `total` / `data` :

```json
[
  {
    "name": "Exemple",
    "grade": "6B+",
    "benchmark": false,
    "method": "",
    "ascensionCount": 0,
    "setby": "",
    "moves": [
      { "description": "A1", "isStart": true },
      { "description": "B2" },
      { "description": "C3" },
      { "description": "K1", "isEnd": true }
    ]
  }
]
```

## Important

La position initiale de la grille dans `app.js` est réglable avec le bouton **Grille**. Elle pourra être ajustée finement une fois le site ouvert dans le navigateur.
