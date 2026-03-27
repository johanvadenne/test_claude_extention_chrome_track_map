# TrackMap — Extension de Conscience de Navigation

Extension Chrome qui analyse en temps réel les trackers, cookies et scripts tiers présents sur chaque page, et cartographie votre session de navigation.

## Fonctionnalités

### 🔍 Analyseur de trackers
- Détecte les scripts tiers, pixels publicitaires, cookies et iframes
- Identifie les trackers connus (Google, Meta, TikTok, Hotjar, Segment, etc.)
- Explique en langage simple **ce que chaque tracker fait vraiment**
- Classe les risques : élevé / modéré / faible
- Badge sur l'icône de l'extension indiquant le nombre de trackers

### 🗺️ Cartographie de session
- Graphe interactif force-directed de tous les sites visités
- Connexions entre sites (transitions, partages de données)
- Taille des nœuds proportionnelle au nombre de visites
- Couleur selon le niveau de risque

### 🔒 Vie privée
- **100% local** — aucune donnée n'est envoyée à l'extérieur
- Analyse côté client uniquement
- Pas de compte requis

---

## Installation (mode développeur)

1. Téléchargez ou clonez ce dossier
2. Ouvrez Chrome et allez sur `chrome://extensions`
3. Activez le **Mode développeur** (bouton en haut à droite)
4. Cliquez **Charger l'extension non empaquetée**
5. Sélectionnez le dossier `trackmap`
6. Naviguez sur n'importe quel site — l'extension s'active automatiquement

---

## Structure des fichiers

```
trackmap/
├── manifest.json          # Configuration de l'extension (Manifest V3)
├── popup.html             # Interface utilisateur principale
├── popup.js               # Logique de l'interface (trackers + graphe)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── background.js      # Service Worker — agrège les données, construit le graphe
    ├── content.js         # Script injecté dans les pages — détecte les trackers
    └── trackers-db.json   # Base de données des trackers connus
```

---

## Architecture technique

```
Page visitée
    ↓
Content Script (content.js)
  • Collecte scripts tiers, iframes, requêtes XHR/fetch
  • Observe les mutations DOM (scripts chargés dynamiquement)
    ↓
Service Worker (background.js)
  • Reçoit les données des pages
  • Croise avec la base trackers-db.json
  • Construit le graphe de session
  • Persiste dans chrome.storage.local
    ↓
Popup (popup.html + popup.js)
  • Vue "Trackers" : liste annotée des trackers identifiés
  • Vue "Ma session" : graphe de navigation force-directed
```

---

## Ajouter des trackers à la base

Éditez `src/trackers-db.json` pour ajouter des entrées :

```json
"exemple.com": {
  "name": "Nom du tracker",
  "owner": "Entreprise propriétaire",
  "category": "advertising",
  "risk": "high",
  "description": "Explication en langage simple de ce que fait ce tracker.",
  "icon": "EX"
}
```

Catégories disponibles : `analytics`, `advertising`, `social`, `tag-manager`, `support`, `infrastructure`, `payment`

Niveaux de risque : `low`, `medium`, `high`

---

## Compatibilité

- Chrome 88+ (Manifest V3)
- Edge 88+
- Pour Firefox : adaptation mineure requise (utilisation de `browser.*` au lieu de `chrome.*`)

---

## Roadmap

- [ ] Export du rapport de trackers (PDF / JSON)
- [ ] Blocage optionnel des trackers identifiés
- [ ] Synchronisation avec des bases publiques (EFF, DuckDuckGo) pour mise à jour auto
- [ ] Vue historique sur plusieurs jours
- [ ] Score de confidentialité global par site
