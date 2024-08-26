/* ScummVM - Graphic Adventure Engine
 *
 * ScummVM is the legal property of its developers, whose names
 * are too numerous to list here. Please refer to the COPYRIGHT
 * file distributed with this source distribution.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

"use strict";

const createLogger = require('logging').default;
const { table, getBorderCharacters } = require('table');
const { Client, Intents, MessageEmbed } = require('discord.js');
const { Areas, Groups } = require('../global/Areas.js');

class Discord {
  constructor(config) {
    this.logger = createLogger("Discord");

    this.sentOffline = false;

    this.scoreboardTableConfig = {
      border: getBorderCharacters('ramac'),
      drawHorizontalLine: (lineIndex, rowCount) => {return lineIndex <= 1 || lineIndex % 2 == 1}
    };

    this.client = new Client({intents: [Intents.FLAGS.GUILDS]});
    this.client.once('ready', async () => {
      this.logger.info("Connected.");
      this.channel = await this.client.channels.fetch(config['channel']);
      let messages = await this.channel.messages.fetch();
      messages = messages.filter(m => m.author.id === config['client']);
      if (messages.first())
        this.lastMessageId = messages.first().id;
      this.logger.info("Now sending population.");
      await this.sendPopulation();

      // Set a timeout
      this.populationTimer = setTimeout(async () => {
        await this.sendPopulation();
        this.populationTimer.refresh();
      }, 30000);

    });

    this.client.login(config['token']);
  }

  async sendPopulation() {
    try {
      let usersOnline = 0;
      let gamesPlaying = 0;

      let baseballUsers = '';
      let footballUsers = '';

      const userIds = Object.values(await redis.redis.hgetall("byonline:users:nameToId")).map(Number);
      let ongoingScoresByHome = {};
      let inGameUserIdsToNames = {};  // Storing so we don't have to call redis for these again later
      for (const userId of userIds) {
        const user = await redis.getUserById(userId);
        if (Object.keys(user).length == 0 || !user.game)
          // Not logged in.
          continue;

        usersOnline++;
        if (user.inGame) {
          gamesPlaying += .5;

          const ongoingResultsStrings = await redis.getOngoingResults(userId, user.game);
          const ongoingResults = Object.fromEntries(
            Object.entries(ongoingResultsStrings).map(([k, stat]) => [k, Number(stat)])
          );
          if (ongoingResults) {
            inGameUserIdsToNames[userId] = user.user;
            if ((ongoingResults.opponentId in ongoingScoresByHome) && (ongoingScoresByHome[ongoingResults.opponentId]["awayId"] == userId)) {
              // This is the away team; we already have the home team's score for this game
              ongoingScoresByHome[ongoingResults.opponentId]["awayScore"] = ongoingResults.runs;
              ongoingScoresByHome[ongoingResults.opponentId]["awayHits"] = ongoingResults.hits;
              ongoingScoresByHome[ongoingResults.opponentId]["completedInnings"] = ongoingResults.completedInnings;
            } else if ((userId in ongoingScoresByHome) && ("awayScore" in ongoingScoresByHome[userId])) {
              // We already have the away team's score for this game. This must be the home team
              ongoingScoresByHome[userId]["homeScore"] = ongoingResults.runs;
              ongoingScoresByHome[userId]["homeHits"] = ongoingResults.hits;
              ongoingScoresByHome[userId]["completedInnings"] = ongoingResults.completedInnings;
            } else if (ongoingResults.isHome == 1) {
              // We don't have either team's score yet and this is the home team. Let's add it
              ongoingScoresByHome[userId] = {
                "awayId": ongoingResults.opponentId,
                "homeScore": ongoingResults.runs,
                "homeHits": ongoingResults.hits,
                "completedInnings": ongoingResults.completedInnings,
              };
            } else if (ongoingResults.isHome == 0) {
              // We don't have either team's score yet and this is the away team. Let's add it
              ongoingScoresByHome[ongoingResults.opponentId] = {
                "awayId": userId,
                "awayScore": ongoingResults.runs,
                "awayHits": ongoingResults.hits,
                "completedInnings": ongoingResults.completedInnings,
              };
            }
          }

        }

        let area = "(Online)";
        let groupName = "";
        if (user.area) {
          const groups = Object.values(Groups);
          if (groups[0].includes(user.area))
            groupName = "Easy Street";
          else if (groups[1].includes(user.area))
            groupName = "Mediumville";
          else if (groups[2].includes(user.area))
            groupName = "Toughy Town";

          area = `${user.inGame ? '(In-Game) ' : ''}(${Areas[user.area]}, ${groupName})`;
        }
        if (user.game == "baseball") {
          baseballUsers += `${user.user} (v${user.version}) ${area}\n`;
        } else {
          footballUsers += `${user.user} (v${user.version}) ${area}\n`;
        }
      }

      const embed = new MessageEmbed()
        .setTitle('Server Population:')
        .setFooter("Updates every 30 seconds.")
        .setColor("GREY")
        .setTimestamp();

      if (!usersOnline)
        embed.setDescription("No one is currently online. :(");
      else {
        embed.setDescription(`Total Population: ${usersOnline}\nGames Currently Playing: ${Math.floor(gamesPlaying)}`);
        if (baseballUsers) {
          let baseballScoresData = [];
          for (const homeId in ongoingScoresByHome) {
            baseballScoresData.push(
              [
                inGameUserIdsToNames[ongoingScoresByHome[homeId]["awayId"]],
                ongoingScoresByHome[homeId]["awayScore"],
                ongoingScoresByHome[homeId]["awayHits"],
                ongoingScoresByHome[homeId]["completedInnings"] + 1,
              ],
              [
                inGameUserIdsToNames[homeId],
                ongoingScoresByHome[homeId]["homeScore"],
                ongoingScoresByHome[homeId]["homeHits"],
                "",
              ]
            )
          }

          embed.addField("Backyard Baseball 2001", baseballUsers);
          if (baseballScoresData.length > 0) {
            const baseballScoreboardText = table(
              [[ '', 'R', 'H', 'Inn' ]].concat(baseballScoresData),
              this.scoreboardTableConfig
            );
            embed.addField(
              "Backyard Baseball 2001 Scoreboard", "```" + baseballScoreboardText + "```"
            );
          }
        }

        if (footballUsers)
          embed.addField("Backyard Football", footballUsers);
      }

      if ((!usersOnline && !this.sentOffline) || usersOnline) {
        if (this.lastMessageId) {
          const message = await this.channel.messages.fetch(this.lastMessageId)
          await message.edit({ embeds: [embed] });
        } else {
          const message = await this.channel.send({ embeds: [embed] });
          this.lastMessageId = message.id;
        }
        if (!usersOnline)
          this.sentOffline = true;
        else
          this.sentOffline = false;
      }
    } catch (error) {
      console.log("Discord error:", error)
    }
  }
}

module.exports = Discord;
