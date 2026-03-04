const { normalizeText, escapeRegex } = require("../utils/text");
const { GEO_CACHE_TTL_MS } = require("../config/constants");

class GeographyService {
  constructor(db, { cacheTtlMs = GEO_CACHE_TTL_MS } = {}) {
    this.db = db;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = {
      expiresAt: 0,
      states: [],
      statesByName: new Map(),
      districts: [],
      districtsByName: new Map(),
      districtNamesSorted: [],
      cities: [],
      citiesBySearch: new Map(),
      cityNamesSorted: [],
      citiesAvailable: true,
    };
  }

  containsNormalized(text, term) {
    const normalizedText = normalizeText(text);
    const normalizedTerm = normalizeText(term);
    if (!normalizedText || !normalizedTerm) return false;
    const termPattern = escapeRegex(normalizedTerm).replace(/\s+/g, "\\s+");
    return new RegExp(`(?:^|\\b)${termPattern}(?:\\b|$)`, "i").test(normalizedText);
  }

  async refreshCache(force = false) {
    const now = Date.now();
    if (!force && now < this.cache.expiresAt && this.cache.states.length && (this.cache.cities.length || this.cache.districts.length)) {
      return;
    }

    const [statesRes, districtsRes, citiesRes] = await Promise.all([
      this.db.from("states").select("id, name, code").order("name", { ascending: true }),
      this.db.from("districts").select("id, name, state_id, states(id, name, code)").order("name", { ascending: true }),
      this.db
        .from("cities")
        .select("name, search_name, district_id, state_id, districts(name, state_id, states(id, name, code))"),
    ]);

    if (statesRes.error) {
      throw new Error(`Failed to load states: ${statesRes.error.message}`);
    }
    if (districtsRes.error) {
      throw new Error(`Failed to load districts: ${districtsRes.error.message}`);
    }

    const statesData = Array.isArray(statesRes.data) ? statesRes.data : [];
    const districtsData = Array.isArray(districtsRes.data) ? districtsRes.data : [];
    let citiesData = [];
    let citiesAvailable = true;
    if (citiesRes.error) {
      const msg = String(citiesRes.error?.message || "");
      const citiesMissing = /could not find the table .*cities/i.test(msg);
      if (!citiesMissing) {
        throw new Error(`Failed to load cities: ${citiesRes.error.message}`);
      }
      citiesAvailable = false;
    } else {
      citiesData = Array.isArray(citiesRes.data) ? citiesRes.data : [];
    }

    const states = statesData.map((row) => ({
      id: row.id,
      name: normalizeText(row.name),
      code: row.code || null,
    }));

    const statesByName = new Map(states.map((s) => [s.name, s]));

    const districts = districtsData.map((row) => ({
      id: row.id,
      district: normalizeText(row?.name || ""),
      state: row?.states?.name ? normalizeText(row.states.name) : null,
      stateCode: row?.states?.code || null,
    }));
    const districtsByName = new Map();
    for (const d of districts) {
      if (d.district && !districtsByName.has(d.district)) {
        districtsByName.set(d.district, d);
      }
    }
    const districtNamesSorted = [...new Set(districts.map((d) => d.district).filter(Boolean))].sort((a, b) => b.length - a.length);

    const cities = citiesData.map((row) => {
      const districtName = row?.districts?.name ? normalizeText(row.districts.name) : null;
      const stateName = row?.districts?.states?.name
        ? normalizeText(row.districts.states.name)
        : normalizeText(row?.state?.name || "");
      const stateCode = row?.districts?.states?.code || null;
      const cityNameRaw = row?.name || row?.search_name || "";
      const cityName = normalizeText(cityNameRaw);
      const searchName = normalizeText(row?.search_name || cityNameRaw);

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
      districts,
      districtsByName,
      districtNamesSorted,
      cities,
      citiesBySearch,
      cityNamesSorted,
      citiesAvailable,
    };
  }

  async getAllStates() {
    await this.refreshCache();
    return this.cache.states.map((s) => s.name);
  }

  async isValidState(stateName) {
    await this.refreshCache();
    const normalized = normalizeText(stateName);
    return this.cache.statesByName.has(normalized);
  }

  async getDistrictsByState(stateName) {
    await this.refreshCache();
    const normalized = normalizeText(stateName);
    if (!normalized) return [];
    const districts = new Set();
    for (const district of this.cache.districts) {
      if (district.state === normalized && district.district) districts.add(district.district);
    }
    return [...districts].sort();
  }

  findCityInText(text) {
    const lower = normalizeText(text);
    if (!lower) return null;
    for (const cityName of this.cache.cityNamesSorted) {
      if (this.containsNormalized(lower, cityName)) {
        return this.cache.citiesBySearch.get(cityName) || null;
      }
    }
    return null;
  }

  findStateInText(text) {
    const lower = normalizeText(text);
    if (!lower) return null;
    for (const state of this.cache.states) {
      if (this.containsNormalized(lower, state.name)) return state;
    }
    return null;
  }

  findDistrictInText(text) {
    const lower = normalizeText(text);
    if (!lower) return null;
    for (const districtName of this.cache.districtNamesSorted) {
      if (this.containsNormalized(lower, districtName)) {
        return this.cache.districtsByName.get(districtName) || null;
      }
    }
    return null;
  }

  async getLocationInfo(cityInput) {
    await this.refreshCache();
    const normalized = normalizeText(cityInput);
    if (!normalized) return null;
    const cached = this.cache.citiesBySearch.get(normalized);
    if (cached) return { ...cached };
    const districtCached = this.cache.districtsByName.get(normalized);
    if (districtCached) {
      return {
        city: null,
        district: districtCached.district || null,
        state: districtCached.state || null,
        stateCode: districtCached.stateCode || null,
        searchName: districtCached.district || null,
      };
    }

    const pattern = `%${normalized}%`;
    if (this.cache.citiesAvailable) {
      const { data } = await this.db
        .from("cities")
        .select("name, search_name, district_id, state_id, districts(name, state_id, states(id, name, code))")
        .or(`search_name.ilike.${pattern},name.ilike.${pattern}`)
        .limit(1)
        .maybeSingle();

      if (data) {
        return {
          city: normalizeText(data.name || data.search_name || normalized),
          district: data?.districts?.name ? normalizeText(data.districts.name) : null,
          state: data?.districts?.states?.name ? normalizeText(data.districts.states.name) : null,
          stateCode: data?.districts?.states?.code || null,
          searchName: normalizeText(data.search_name || data.name || normalized),
        };
      }
    }

    const { data: districtData } = await this.db
      .from("districts")
      .select("name, state_id, states(id, name, code)")
      .ilike("name", pattern)
      .limit(1)
      .maybeSingle();
    if (!districtData) return null;
    return {
      city: null,
      district: normalizeText(districtData.name || normalized),
      state: districtData?.states?.name ? normalizeText(districtData.states.name) : null,
      stateCode: districtData?.states?.code || null,
      searchName: normalizeText(districtData.name || normalized),
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

    const districtHit = this.findDistrictInText(text);
    if (districtHit) {
      return {
        city: null,
        district: districtHit.district || null,
        state: districtHit.state || null,
        stateCode: districtHit.stateCode || null,
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
    const lower = normalizeText(text);
    if (!lower) return [];

    const states = new Set();
    for (const state of this.cache.states) {
      if (this.containsNormalized(lower, state.name)) states.add(state.name);
    }

    for (const cityName of this.cache.cityNamesSorted) {
      if (!this.containsNormalized(lower, cityName)) continue;
      const location = this.cache.citiesBySearch.get(cityName);
      if (location?.state) states.add(location.state);
    }

    for (const districtName of this.cache.districtNamesSorted) {
      if (!this.containsNormalized(lower, districtName)) continue;
      const location = this.cache.districtsByName.get(districtName);
      if (location?.state) states.add(location.state);
    }

    return [...states];
  }
}

module.exports = { GeographyService };
