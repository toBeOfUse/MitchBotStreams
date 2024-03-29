import { Knex } from "knex";
import { PlaylistRecord, Video } from "../../../constants/types";
export async function seed(knex: Knex): Promise<void> {
    await knex<PlaylistRecord>("playlists").insert([
        {
            name: "Couple of Mirrors",
            createdAt: Date.now(),
            publicallyEditable: false,
            id: 0,
        },
        {
            name: "MitchBot Recommends",
            createdAt: Date.now(),
            publicallyEditable: false,
            id: 1,
        },
        {
            name: "The Unrestrained Id of the Audience",
            createdAt: Date.now(),
            publicallyEditable: false,
            id: 2,
        },
    ]);
    await knex<Omit<Video, "captions">>("videos")
        .insert([
            {
                duration: 2742,
                playlistID: 0,
                id: 1,
                provider: "youtube",
                src: "GU4DJf2_jqE",
                title: "《双镜 Couple of Mirrors》EP01: 3，2，1",
            },
            {
                duration: 2852,
                playlistID: 0,
                id: 2,
                provider: "youtube",
                src: "8zqUunbOsoQ",
                title: "《双镜 Couple of Mirrors》EP02: In the cold rainy night",
            },
            {
                duration: 2801,
                playlistID: 0,
                id: 3,
                provider: "youtube",
                src: "SCp4a42sdWc",
                title: "《双镜 Couple of Mirrors》EP03: When the gun is fired",
            },
            {
                duration: 3011,
                playlistID: 0,
                id: 4,
                provider: "youtube",
                src: "6btkPmu8j9M",
                title: "《双镜 Couple of Mirrors》EP04: Welcome to My World",
            },
            {
                duration: 2705,
                playlistID: 0,
                id: 5,
                provider: "youtube",
                src: "Qx896VPc0LM",
                title: "《双镜 Couple of Mirrors》EP05: The Scene of the Third Crime",
            },
            {
                duration: 374,
                playlistID: 1,
                id: 6,
                provider: "vimeo",
                src: "33548881",
                title: "Girl Walk // All Day: Chapter 5",
            },
            {
                duration: 317,
                playlistID: 1,
                id: 7,
                provider: "vimeo",
                src: "33560398",
                title: "Girl Walk // All Day: Chapter 6",
            },
            {
                duration: 384,
                playlistID: 1,
                id: 8,
                provider: "vimeo",
                src: "33807212",
                title: "Girl Walk // All Day: Chapter 7",
            },
            {
                duration: 132,
                playlistID: 1,
                id: 9,
                provider: "youtube",
                src: "NHZr6P1csiY",
                title: "and the day goes on - bill wurtz",
            },
            {
                duration: 165,
                playlistID: 1,
                id: 10,
                provider: "youtube",
                src: "mpkf_p71rKY",
                title: "might quit - bill wurtz",
            },
            {
                duration: 153,
                playlistID: 1,
                id: 11,
                provider: "youtube",
                src: "nBHkIWAJitg",
                title: "Handsome Dancer - Coincidance",
            },
            {
                duration: 481,
                playlistID: 1,
                id: 12,
                provider: "youtube",
                src: "yE5DiniY45w",
                title: "Pop Danthology 2012 - Mashup of 50+ Pop Songs",
            },
            {
                duration: 149,
                playlistID: 1,
                id: 13,
                provider: "youtube",
                src: "3L7VJl76i9U",
                title: "Crybaby Learns to Swim",
            },
            {
                duration: 9,
                playlistID: 1,
                id: 14,
                provider: "youtube",
                src: "4Rr-ra5Sobk",
                title: "small woof",
            },
            {
                duration: 261,
                playlistID: 1,
                id: 15,
                provider: "youtube",
                src: "VuE4qxOcluk",
                title: "75 Big Mouth Billy Bass fish sing Bee Gees' 'Stayin Alive,' Talking Heads' 'Once in a Lifetime'",
            },
            {
                duration: 848,
                playlistID: 1,
                id: 16,
                provider: "youtube",
                src: "guMbC8Gig6I",
                title: "Taskmaster’s Most Romantic Moments",
            },
            {
                duration: 692,
                playlistID: 1,
                id: 18,
                provider: "youtube",
                src: "DSUilYKcRMA",
                title: "Joe Pera Talks You Back to Sleep (Full Episode) | Joe Pera Talks With You | adult swim",
            },
            {
                duration: 9719,
                playlistID: 1,
                id: 23,
                provider: "youtube",
                src: "WJndaDpohSY",
                title: "History of The Hobbit - The Most Underrated Speedrun",
            },
        ])
        .onConflict()
        .ignore();
}
