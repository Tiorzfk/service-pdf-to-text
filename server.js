const dotenv = require("dotenv")
var amqp = require('amqplib/callback_api');
const stream = require('stream');
const util = require('util');
var fs = require('fs');
var axios = require('axios');
var pdfUtil = require('pdf-to-text');
var path = require("path");
const { log } = require("console");
const pdf_extract = require('pdf-extract')
const { start } = require("repl");
const exec = util.promisify(require('child_process').exec);

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
            content.file_pdf = content.file_pdf.replace(/(token=)[^\&]+/, '$1eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwOlwvXC8xOTQuMTYwLjIuMlwvYXBpXC9hdXRoXC9yZWZyZXNoIiwiaWF0IjoxNjg5Nzc3NTg5LCJleHAiOjE2OTAxMjc1NjEsIm5iZiI6MTY5MDEwNTk2MSwianRpIjoiUHBLajNBb2FVdUMxcW4xRSIsInN1YiI6Mjc2LCJwcnYiOiIyM2JkNWM4OTQ5ZjYwMGFkYjM5ZTcwMWM0MDA4NzJkYjdhNTk3NmY3IiwiYmFzZV91cmwiOiJodHRwOlwvXC8xODIuMjMuMjIuMTMxXC9iZSIsImRldmljZSI6IndlYiIsImd1YXJkIjoiYXBpIn0.FlMhIbE1_zhmTsMQJGh_fjivVtV5oLs6UUR67t8PIOY');
            console.log(" [x] Received %s", content);

            if(content.file_pdf)
            {    
                var file_name = content.ebook_id+'_'+content.file_name
                var file_pdf = content.file_pdf.replaceAll(' & ', ' %26 ').replaceAll('R&D', 'R%26D')
                await downloadFile(file_pdf, 'pdf/'+file_name)
                // await downloadFile(cels_api+content.file_pdf, 'pdf/'+file_name)
    
                //option to extract text 10 page
                // var option = {from: content.start_page, to: content.start_page+10};
                // var pdfText = await pdfToText('./pdf/'+file_name_edited, option)

                //change pdf page to 10
                var start_page = content.start_page
                var end_page = content.start_page+10
                var file_name_path = path.resolve('./pdf/'+file_name)
                var file_name_edited = file_name.replace('.pdf', '') + ' edited.pdf'
                var file_name_edited_path = path.resolve('./pdf/'+file_name_edited)
                
                try {
                    const { stdout, stderr } = await exec('pdftk "'+file_name_path+'" cat '+start_page+'-'+end_page+' output "'+file_name_edited_path+'"');
                    console.log('stdout:', stdout);
                    console.log('stderr:', stderr);
    
                    // //convert to greyscale
                    // const { stdout2, stderr2 } = await exec('gs \
                    // -sDEVICE=pdfwrite \
                    // -sProcessColorModel=DeviceGray \
                    // -sColorConversionStrategy=Gray \
                    // -dPDFUseOldCMS=false \
                    // -o "'+file_name_edited_path+'" \
                    // -f "'+file_name_edited_path+'"');
                    // console.log('stdout greyscale:', stdout2);
                    // console.log('stderr greyscale:', stderr2);
    
                    var option = content
                    var pdfText = await pdfToTextOcr('./pdf/'+file_name_edited, option)
        
                    //save text to db
                    if(pdfText.trim())
                    {
                        await saveText(content.ebook_id, pdfText)
                    }else{
                        await saveText(content.ebook_id, "error", "error")
                    }
                } catch (error) {
                    await saveText(content.ebook_id, "error", "error")
                }
            }

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

async function pdfToTextOcr(relative_path, option) {
    // var result_text = ''
    // var start_page = option.start_page
    // var end_page = option.start_page+10
    return new Promise((resolve, reject) => {
        // pdfUtil.pdfToText(path.resolve(relative_path), option, function(err, data) {
        //     if (err) return reject(err);
            
        //     return resolve(data)
        // });

        const options = {
            type: 'ocr', // perform ocr to get the text within the scanned image
            ocr_flags: ['--psm 1'], // automatically detect page orientation
        }
        const processor = pdf_extract(path.resolve(relative_path), options, ()=>console.log("Starting…"))
        // processor.on('page', data => {
        //     // resolve(data.text)
        //     if((data.index+1) >= start_page)
        //     {
        //         if((data.index+1) > end_page)
        //         {
        //             resolve(result_text)
        //         }

        //         result_text += data.text

        //         console.log("OCR converting page "+(data.index+1)+" (v)");
        //     }else{
        //         console.log("OCR converting page "+(data.index+1)+" (x)");
        //     }
        // })
        processor.on('page', data => {
            console.log("OCR converting page "+data.index, data);
        })
        processor.on('complete', data => callback(null, data))
        processor.on('error', callback)
        function callback (error, data) { 
            if(error) {
                console.error(error)
                reject(error)
            }else{
                console.log(data.text_pages.join(' '))
                resolve(data.text_pages.join(' '))
            } 
        }
    })
}

async function pdfToText(relative_path, option) {
    // var result_text = ''
    // var start_page = option.start_page
    // var end_page = option.start_page+10
    return new Promise((resolve, reject) => {
        // pdfUtil.pdfToText(path.resolve(relative_path), option, function(err, data) {
        //     if (err) return reject(err);
            
        //     return resolve(data)
        // });

        const options = {
            type: 'ocr', // perform ocr to get the text within the scanned image
            ocr_flags: ['--psm 1'], // automatically detect page orientation
        }
        const processor = pdf_extract(path.resolve(relative_path), options, ()=>console.log("Starting…"))
        // processor.on('page', data => {
        //     // resolve(data.text)
        //     if((data.index+1) >= start_page)
        //     {
        //         if((data.index+1) > end_page)
        //         {
        //             resolve(result_text)
        //         }

        //         result_text += data.text

        //         console.log("OCR converting page "+(data.index+1)+" (v)");
        //     }else{
        //         console.log("OCR converting page "+(data.index+1)+" (x)");
        //     }
        // })
        processor.on('page', data => {
            console.log("OCR converting page "+data.index, data);
        })
        processor.on('complete', data => callback(null, data))
        processor.on('error', callback)
        function callback (error, data) { 
            if(error) {
                console.error(error)
                reject(error)
            }else{
                console.log(data.text_pages.join(' '))
                resolve(data.text_pages.join(' '))
            } 
        }
    })
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
    }).catch(err => {
        console.log(err);
    });
}

async function saveText(ebook_id, text, status = 'success') {
    return axios.post(`http://localhost:8000/api/ebook/text`, {
        ebook_id: ebook_id,
        text: text,
        status: status
      }).then(function (response) {
            console.log(" [x] Save Text Success");
      })
      .catch(function (error) {
        console.log(" [x] Save Text Failed", error);
      });
}
