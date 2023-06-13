const dotenv = require("dotenv")
var amqp = require('amqplib/callback_api');
const stream = require('stream');
const util = require('util');
var fs = require('fs');
var axios = require('axios');
var pdfUtil = require('pdf-to-text');
var path = require("path");

dotenv.config()

const finished = util.promisify(stream.finished);

const rabbitmq_host = process.env.RABBITMQ_HOST
const cels_api = process.env.CELS_API

amqp.connect('amqp://'+rabbitmq_host, function(error0, connection) {
    if (error0) {
        throw error0;
    }
    connection.createChannel(function(error1, channel) {
        if (error1) {
            throw error1;
        }
        var queue = 'convert_pdf_text';

        channel.assertQueue(queue, {
            durable: true
        });
        channel.prefetch(1);
        console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", queue);
        channel.consume(queue, async function(msg) {
            var content = JSON.parse(msg.content.toString())
            console.log(" [x] Received %s", content);

            var file_name = content.ebook_id+'_'+content.file_name
            await downloadFile(cels_api+content.file_pdf, 'pdf/'+file_name)

            //option to extract text from page 0 to 10
            var option = {from: content.start_page, to: content.start_page+10};
            await pdfToText('./pdf/'+file_name, option)

            setTimeout(function() {
                console.log(" [x] Done");
                channel.ack(msg);
            }, 1000);
        }, {
            // manual acknowledgment mode,
            // see ../confirms.html for details
            noAck: false
        });
    });
});

async function pdfToText(relative_path, option) {
    return pdfUtil.pdfToText(path.resolve(relative_path), option, function(err, data) {
        if (err) throw(err);
        console.log(data); //print text    
    });
}

async function downloadFile(fileUrl, outputLocationPath) {
    const writer = fs.createWriteStream(outputLocationPath);
    return axios({
      method: 'get',
      url: fileUrl,
      responseType: 'stream',
    }).then(response => {
      response.data.pipe(writer);
      return finished(writer); //this is a Promise
    });
  }
