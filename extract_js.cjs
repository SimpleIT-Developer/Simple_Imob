
const fs = require('fs');
const pdf = require('pdf-parse');

const pdfPath = 'd:\\Imob_Simple\\Cadastros\\Proprietários\\relatorio pro.prn.pdf';

let dataBuffer = fs.readFileSync(pdfPath);

pdf(dataBuffer).then(function(data) {
    console.log("--- TEXTO EXTRAÍDO ---");
    console.log(data.text);
    console.log("--- FIM DO TEXTO ---");
}).catch(function(error) {
    console.error("Error:", error);
});
