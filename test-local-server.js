require("dotenv").config();
const app = require("./src/server");
app.listen(8080, async () => {
    console.log("Server listening on 8080. Making test request...");
    // Create a mock token for auth if needed, but wait, requireAuth checks for token!
    // Let's bypass requireAuth or generate a token
});
