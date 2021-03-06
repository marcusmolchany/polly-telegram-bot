const AWS = require('aws-sdk');
const TelegramBot = require('node-telegram-bot-api');
const request = require('request');

const constants = require('./constants.js');
const creds = require('./creds.js');
const token = require('./token.js');
const voiceIds = require('./voice-ids.js');

const CHAR_LIMIT = constants.polly.CHAR_LIMIT;
const bot = new TelegramBot(token);

AWS.config = new AWS.Config(creds);

// lock api version to 2016-06-10
const s3 = new AWS.S3({ apiVersion: '2016-06-10' });
const polly = new AWS.Polly({ apiVersion: '2016-06-10' });


exports.handler = (event, context, callback) => {
  var chatId = null;
  var message = '';
  var firstWord = '';
  var voiceId = 'Russell'; // default voice id

  if (event.body.message.chat && event.body.message.chat.id) {
    chatId = event.body.message.chat.id;
  }

  if (event && event.body && event.body.message && event.body.message.text) {
    message = event.body.message.text.trim();
  }

  // extract the first word of the message to see if it is a command
  firstWord = message.split(' ')[0];
  if (firstWord[0] === '/') {
    firstWord = firstWord.slice(1); // remove the slash from the command
  }

  firstWord = firstWord[0].toUpperCase() + firstWord.slice(1); // capitalize the first letter

  // check if the first word is in the list of voice ids
  if (voiceIds.indexOf(firstWord) !== -1) {
    voiceId = firstWord;
    message = message.split(' ').slice(1).join(' '); // remove first word from message
  }

  if (message.length > CHAR_LIMIT) {
    bot.sendChatAction(chatId, 'typing');
    bot.sendMessage(chatId, `message must have less than ${CHAR_LIMIT} characters.`);
    return callback(`message exceeded ${CHAR_LIMIT} characters`);
  }

  const pollyParams = {
    // OutputFormat: 'ogg_vorbis', todo: convert ogg vorbis to ogg opus so .sendVoice() will work
    OutputFormat: 'mp3',
    Text: message,
    VoiceId: voiceId,
    LexiconNames: [],
    SampleRate: '16000',
    TextType: 'text'
  };

  polly.synthesizeSpeech(pollyParams, (err, data) => {
    if (err) {
      bot.sendChatAction(chatId, 'typing');
      bot.sendMessage(chatId, 'error with polly synthesizeSpeech.');
    }

    const uploadParams = {
      Bucket: constants.s3.bucketName,
      Key: 'file-' + Date.now() + '.mp3',
      ACL: 'public-read',
      Body: data.AudioStream,
      Expires: new Date(Date.now() + 1800000) // 1800000ms is 30 minutes
    };

    // call S3 to retrieve upload file to specified bucket
    s3.upload(uploadParams, (err, data) => {
      if (err) {
        callback('s3 upload error', err);
        bot.sendChatAction(chatId, 'typing');
        bot.sendMessage(chatId, err);
      } else if (data) {
        callback('s3 upload success', data);
        const audio = request(data.Location);
        bot.sendChatAction(chatId, 'upload_audio');
        bot.sendAudio(chatId, audio);
      }
    });
  });
}
