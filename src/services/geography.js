class GeographyService {
  constructor(db, { cacheTtlMs = 5 * 60 * 1000 } = {}) {
    this.db = db;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = {
      expiresAt: 0,
      states: [],
      statesByName: new Map(),
      cities: [],
      citiesBySearch: new Map(),
      cityNamesSorted: [],
    };
  }

  normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async refreshCache(force = false) {
    const now = Date.now();
    if (!force && now < this.cache.expiresAt && this.cache.states.length && this.cache.cities.length) {
      return;
    }

    const [statesRes, citiesRes] = await Promise.all([
      this.db.from("states").select("id, name, code").order("name", { ascending: true }),
      this.db
        .from("cities")
        .select("name, search_name, district_id, state_id, districts(name, state_id, states(id, name, code))"),
    ]);

    if (statesRes.error) {
      throw new Error(`Failed to load states: ${statesRes.error.message}`);
    }
    if (citiesRes.error) {
      throw new Error(`Failed to load cities: ${citiesRes.error.message}`);
    }

    const statesData = Array.isArray(statesRes.data) ? statesRes.data : [];
    const citiesData = Array.isArray(citiesRes.data) ? citiesRes.data : [];

    const states = statesData.map((row) => ({
      id: row.id,
      name: this.normalize(row.name),
      code: row.code || null,
    }));

    const statesByName = new Map(states.map((s) => [s.name, s]));

    const cities = citiesData.map((row) => {
      const districtName = row?.districts?.name ? this.normalize(row.districts.name) : null;
      const stateName = row?.districts?.states?.name
        ? this.normalize(row.districts.states.name)
        : this.normalize(row?.state?.name || "");
      const stateCode = row?.districts?.states?.code || null;
      const cityNameRaw = row?.name || row?.search_name || "";
      const cityName = this.normalize(cityNameRaw);
      const searchName = this.normalize(row?.search_name || cityNameRaw);

      return {
        city: cityName,
        district: districtName,
        state: stateName || null,
        stateCode,
        searchName,
      };
    });

    const citiesBySearch = new Map();
    for (const city of cities) {
      if (city.searchName && !citiesBySearch.has(city.searchName)) {
        citiesBySearch.set(city.searchName, city);
      }
      if (city.city && !citiesBySearch.has(city.city)) {
        citiesBySearch.set(city.city, city);
      }
    }

    const cityNamesSorted = [...new Set(cities.map((c) => c.searchName || c.city).filter(Boolean))].sort(
      (a, b) => b.length - a.length
    );

    this.cache = {
      expiresAt: now + this.cacheTtlMs,
      states,
      statesByName,
      cities,
      citiesBySearch,
      cityNamesSorted,
    };
  }

  async getAllStates() {
    await this.refreshCache();
    return this.cache.states.map((s) => s.name);
  }

  async isValidState(stateName) {
    await this.refreshCache();
    const normalized = this.normalize(stateName);
    return this.cache.statesByName.has(normalized);
  }

  async getDistrictsByState(stateName) {
    await this.refreshCache();
    const normalized = this.normalize(stateName);
    if (!normalized) return [];
    const districts = new Set();
    for (const city of this.cache.cities) {
      if (city.state === normalized && city.district) districts.add(city.district);
    }
    return [...districts].sort();
  }

  findCityInText(text) {
    const lower = this.normalize(text);
    if (!lower) return null;
    for (const cityName of this.cache.cityNamesSorted) {
      if (lower.includes(cityName)) {
        return this.cache.citiesBySearch.get(cityName) || null;
      }
    }
    return null;
  }

  findStateInText(text) {
    const lower = this.normalize(text);
    if (!lower) return null;
    for (const state of this.cache.states) {
      if (lower.includes(state.name)) return state;
    }
    return null;
  }

  async getLocationInfo(cityInput) {
    await this.refreshCache();
    const normalized = this.normalize(cityInput);
    if (!normalized) return null;
    const cached = this.cache.citiesBySearch.get(normalized);
    if (cached) return { ...cached };

    const pattern = `%${normalized}%`;
    const { data } = await this.db
      .from("cities")
      .select("name, search_name, district_id, state_id, districts(name, state_id, states(id, name, code))")
      .or(`search_name.ilike.${pattern},name.ilike.${pattern}`)
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    return {
      city: this.normalize(data.name || data.search_name || normalized),
      district: data?.districts?.name ? this.normalize(data.districts.name) : null,
      state: data?.districts?.states?.name ? this.normalize(data.districts.states.name) : null,
      stateCode: data?.districts?.states?.code || null,
      searchName: this.normalize(data.search_name || data.name || normalized),
    };
  }

  async getStateByCity(cityInput) {
    const location = await this.getLocationInfo(cityInput);
    return location?.state || null;
  }

  async getDistrictByCity(cityInput) {
    const location = await this.getLocationInfo(cityInput);
    return location?.district || null;
  }

  async extractFromText(text) {
    await this.refreshCache();
    const cityHit = this.findCityInText(text);
    if (cityHit) {
      return {
        city: cityHit.city || null,
        district: cityHit.district || null,
        state: cityHit.state || null,
        stateCode: cityHit.stateCode || null,
      };
    }

    const stateHit = this.findStateInText(text);
    if (stateHit) {
      return {
        city: null,
        district: null,
        state: stateHit.name || null,
        stateCode: stateHit.code || null,
      };
    }

    return {
      city: null,
      district: null,
      state: null,
      stateCode: null,
    };
  }

  async extractMentionedStates(text) {
    await this.refreshCache();
    const lower = this.normalize(text);
    if (!lower) return [];

    const states = new Set();
    for (const state of this.cache.states) {
      if (lower.includes(state.name)) states.add(state.name);
    }

    for (const cityName of this.cache.cityNamesSorted) {
      if (!lower.includes(cityName)) continue;
      const location = this.cache.citiesBySearch.get(cityName);
      if (location?.state) states.add(location.state);
    }

    return [...states];
  }
}

module.exports = { GeographyService };
