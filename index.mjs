import AWS from 'aws-sdk';
import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { PassThrough } from "stream";
import { mm2pt } from "swissqrbill/utils";
import { Table } from "swissqrbill/pdf";
const s3 = new AWS.S3();

export const handler = async (event) => {
    // Extrait les données de l'event
    let data;

    // Vérifier si event.body existe et n'est pas undefined
    if (event.body) {
        try {
            data = JSON.parse(event.body);
        } catch (error) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: "Invalid JSON format" })
            };
        }
    } else {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "No data provided" })
        };
    }

    // Get all rows total 
    // "rows": [
    //     {
    //       "position": "1",
    //       "quantity": "1",
    //       "description": "Souper annuel 2023",
    //       "total" : "60"
    //     }
    //   ]
    let totalAmount = 0;
    data.rows.forEach(element => {
        totalAmount += parseFloat(element.total);
    });


    



    const rows = data.rows;
    const summary = data.summary;

    const pdf = new PDFDocument({ size: "A4" });
    const qrBill = new SwissQRBill(data, {
        language: "FR"
    });


    const stream = new PassThrough();
    qrBill.attachTo(pdf);
    pdf.pipe(stream);

    // Address
    pdf.fontSize(12);
    pdf.fillColor("black");
    pdf.font("Helvetica");
    pdf.text(`${data.creditor.name}\n${data.creditor.address} ${data.creditor.buildingNumber}\n${data.creditor.zip} ${data.creditor.city}`, mm2pt(20), mm2pt(35), {
      align: "left",
      height: mm2pt(50),
      width: mm2pt(100)
    });
    
    pdf.fontSize(12);
    pdf.font("Helvetica");
    pdf.text(`${data.debtor.name}\n${data.debtor.address} ${data.debtor.buildingNumber}\n${data.debtor.zip} ${data.debtor.city}`, mm2pt(130), mm2pt(60), {
      align: "left",
      height: mm2pt(50),
      width: mm2pt(70)
    });

    // Title and date
    pdf.fontSize(14);
    pdf.font("Helvetica-Bold");
    pdf.text(`Facture Nr. ${data.bill_number}`, mm2pt(20), mm2pt(100), {
    align: "left",
    width: mm2pt(170)
    });

    const date = new Date();

    pdf.fontSize(11);
    pdf.font("Helvetica");
    pdf.text(`${data.creditor.city} ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`, {
    align: "right",
    width: mm2pt(170)
    });


    // Construction des lignes de la table avec les données
    const tableRows = data.rows.map(row => {
        return {
        columns: [
            { text: row.quantity, width: mm2pt(20) },
            { text: row.description },
            { text: row.total, width: mm2pt(30) }
        ],
        padding: 5
        };
    });

    // Ajouter la ligne d'en-tête
    tableRows.unshift({
    backgroundColor: "#4A4D51",
    columns: [
        { text: "Quantité", width: mm2pt(20) },
        { text: "Description" },
        { text: "Total", width: mm2pt(30) }
    ],
    font: "Helvetica-Bold",
    height: 20,
    padding: 5,
    textColor: "#fff",
    verticalAlign: "center"
    });


    tableRows.push(
    {
        columns: [
        { text: "", width: mm2pt(20) },
        { text: "" },
        { text: "", width: mm2pt(30) }
        ],
        padding: 5
    },
    // Ligne pour le total avec TVA
    {
        columns: [
        { text: "", width: mm2pt(20) },
        { text: "Total", font: "Helvetica-Bold" },
        { text: `CHF ${totalAmount.toFixed(2)}`, width: mm2pt(30), font: "Helvetica-Bold" }
        ],
        padding: 5
    }
    );
    

    // Création de l'objet Table
    const table = new Table({
    rows: tableRows,
    width: mm2pt(170)
    });
    
    table.attachTo(pdf);
    const filename = `facture-${data.bill_number}.pdf`;


    // À la place de l'upload sur S3, convertissez le stream en base64
    const buffers = [];
    stream.on('data', (chunk) => buffers.push(chunk));
    stream.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        const base64pdf = pdfBuffer.toString('base64');

        // Retournez le PDF encodé en base64 dans la réponse
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename=filename',
            },
            body: base64pdf,
            isBase64Encoded: true,
        };
    });

    pdf.end();

    // // S3
    // pdf.end();

    // const params = {
    //     Bucket: "swiss-qr-code",
    //     Key: "qr-bill.pdf",
    //     Body: stream,
    //     ContentType: "application/pdf"
    // };

    // try {
    //     const uploadData = await s3.upload(params).promise();

    //     // Générer un URL présigné
    //     const signedUrl = await s3.getSignedUrlPromise('getObject', {
    //         Bucket: params.Bucket,
    //         Key: params.Key,
    //         Expires: 60 * 5 // Lien valide pour 5 minutes
    //     });

    //     return {
    //         statusCode: 200,
    //         body: JSON.stringify({ url: signedUrl })
    //     };
    // } catch (error) {
    //     return {
    //         statusCode: 500,
    //         body: JSON.stringify(error)
    //     };
    // }
};

