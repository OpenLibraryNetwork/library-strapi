const config = {
  tutorials: false,
  notifications: { releases: false },
  translations: {
    en: {
      "app.components.LeftMenu.navbrand.title": "Aperta",
      "app.components.LeftMenu.navbrand.workplace": "By Gizmolab",
      "app.utils.add-filter": "Προσθήκη Φίλτρου",
      "app.utils.filters": "Φίλτρα",
      "content-manager.HeaderLayout.button.label-add-entry": "Δημιουργία νέου",
      "content-manager.components.AddFilterCTA.add": "Φίλτρα",
      "content-manager.components.AddFilterCTA.hide": "Φίλτρα",
      "content-manager.header.name": "Υλικό",
      "content-manager.pages.ListView.header-subtitle": "{number, plural, =0 {# αντικείμενα} one {# αντικείμενο} other {# αντικείμενα}}",
      "content-manager.select.currently.selected": "{count} επιλεγμένα",
      "global.content-manager": "Επεξεργασία Υλικού",
    },
  },
};

const bootstrap = () => {};

export default {
  config,
  bootstrap,
};
