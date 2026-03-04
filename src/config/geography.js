const PROFESSION_KEYWORDS = {
  farmer: ["farmer", "agriculture", "kisan", "cultivator"],
  student: ["student", "school", "college"],
  worker: ["worker", "labour", "labor", "daily wage"],
  entrepreneur: [
    "business",
    "entrepreneur",
    "startup",
    "self employed",
    "self-employed",
    "shop",
    "store",
    "medical shop",
    "medicine shop",
    "pharmacy",
    "dukan",
    "dukandar",
    "trader",
  ],
};

const CATEGORY_KEYWORDS = {
  sc: ["sc", "scheduled caste"],
  st: ["st", "scheduled tribe", "tribal"],
  obc: ["obc", "backward class", "other backward class"],
  ews: ["ews", "economically weaker"],
  minority: ["minority"],
  general: ["general category", "open category"],
};

module.exports = {
  PROFESSION_KEYWORDS,
  CATEGORY_KEYWORDS,
};
