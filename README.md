# MitchBot Streams

MitchBot Streams is a useful platform for watching different kinds of videos in sync with a group of people that spun off from my Discord bot MitchBot as a simple service for a Discord server I was in. In addition to synchronizing multiple clients as they watch a Youtube, Vimeo, Dailymotion, or native HTML5 video that is either user-submitted or from a built-in playlist, MitchBot Streams provides social features such as a chat client and an elegant visualization of the virtual scene you are watching the video in.

## How to Use

Run `yarn install` to add the Javascript package dependencies; run `yarn knex --knexfile ./back/db/knexfile.ts migrate:latest` to get an up-to-date instance of the SQLite database that stores messages and playlists; run `yarn knex --knexfile ./back/db/knexfile.ts seed:run` to load the initial playlist that MitchBot ships with into it; run `npx ts-node .\back\db\ensure_video_metadata.ts` to finalize the metadata (the thumbnail and duration) for any initial videos you have; and use `yarn serve` to run the server for development or `yarn serve-production` with NODE_ENV set to production to deploy the server.

MitchBot Streams uses Webpack to create Javascript and CSS bundles; Socket.io facilitates its two-way client-server communication in conjunction with Express; the styling of the chat window makes use of the npm package XP.css; most of the page uses the open-source font B612; as mentioned above, the ORM library knex manages the database, which is currently created with SQLite; the stylesheets are written in SCSS; and Vue renders the non-video elements of the player page, such as the chat window, the playlists, and the audience visualization. Other dependencies are listed in the package.json.
