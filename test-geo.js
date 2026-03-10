require("dotenv").config();
const { GeographyService } = require("./src/services/geography");
const { getSupabaseClient } = require("./lib/supabase");

async function testGeo() {
    const geo = new GeographyService(getSupabaseClient());
    try {
        const text = "Bihar Rajya Fasal Sahayata Yojana";
        const states = await geo.extractMentionedStates(text);
        console.log("Extracted states for", text, ":", states);

        console.log("Is Bihar valid?", await geo.isValidState("Bihar"));
    } catch (err) {
        console.error(err);
    }
}
testGeo();
