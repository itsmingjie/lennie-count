const { WebClient } = require("@slack/web-api");
const { createEventAdapter } = require("@slack/events-api");
require("dotenv").config();

// An access token (from your Slack app or custom integration - xoxp, xoxb)
const token = process.env.SLACK_TOKEN;
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const port = process.env.PORT || 3000;
const web = new WebClient(token);

var Airtable = require("airtable");
Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: process.env.AIRTABLE_KEY,
});
var base = Airtable.base(process.env.AIRTABLE_BASE);

// This argument can be a channel ID, a DM ID, a MPDM ID, or a group ID
const monitoringChannel = process.env.SLACK_CHANNEL;

let previous = ["", 9999999999999];
let counter = 0;

slackEvents.on("message", (event) => {
  console.log(`User ${event.user} in channel ${event.channel} messaged`);

  console.log(event.ts);

  if (event.channel == monitoringChannel && event.user != undefined) {
    if (event.user == previous[0]) {
      // duplicate user -- error
      yikes("Error: Duplicate user", event.ts, event.user);
    } else if (event.ts - previous[1] >= 60) {
      yikes("Error: Rush", event.ts, event.user);
    } else if (Number(event.text) == NaN) {
      yikes("Error: Not a number", event.ts, event.user);
    } else if (Number(event.text) != counter + 1) {
      yikes("Error: Incorrect number", event.ts, event.user);
    } else {
      counter++;
      previous[0] = event.user;
      previous[1] = event.ts;
      console.log("Counter bumped! " + counter);

      (async () => {
        const res = await web.reactions.add({
          channel: monitoringChannel,
          name: "ok",
          timestamp: event.ts,
        });
    
        console.log("Reaction sent: ", res.ts);
      })();
    }
  }
});

let yikes = (reason, ts, user) => {
  base("Score").create(
    [
      {
        fields: {
          timestamp: Number(ts),
          Score: counter,
          "Broken By": user,
        },
      },
    ],
    function (err, records) {
      if (err) {
        console.error(err);
        return;
      }
    }
  );

  counter = 0;
  previous = ["", 9999999999999];

  const rule = `1. You must count in order, starting with 1\n2. The same user cannot count two consecutive numbers\n3. A timer will be set for 60 seconds every time a new number is added. When the timer runs out, the game resets.\n4. All messages in this channel must be valid counting numbers.`

  base("Score")
    .select({
      // Selecting the first 3 records in Grid view:
      maxRecords: 1,
      view: "Grid view",
      sort: [{ field: "Score", direction: "desc" }],
    })
    .eachPage(
      function page(records, fetchNextPage) {
        // This function (`page`) will get called for each page of records.

        records.forEach(function (record) {
          (async () => {
            const res = await web.chat.postMessage({
              channel: monitoringChannel,
              thread_ts: ts,
              text: `Oh, so ya forgot that too, did ya? Well, I ain’t gonna remind ya, fear ya do it again. It's time to start over!\n\n*Rules:*\n${rule}\n\nHigh score: ${record.get(
                "Score"
              )}`,
            });

            console.log("Message sent: ", res.ts);
          })();
        });

        fetchNextPage();
      },
      function done(err) {
        if (err) {
          console.error(err);
          return;
        }
      }
    );

  console.log(reason);

  (async () => {
    const res = await web.reactions.add({
      channel: monitoringChannel,
      name: "bangbang",
      timestamp: ts,
    });

    console.log("Reaction sent: ", res.ts);
  })();
};

slackEvents.on("error", console.error);

slackEvents.start(port).then(() => {
  console.log(`server listening on port ${port}`);
});
