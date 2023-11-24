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

    // Add data.amount 
    let sum = 0;
    data.rows.forEach(row => {
        sum += parseFloat(row.total.replace('CHF ', '').replace("'", ""));
    }
    );
    // Add TVA
    let taxAmount = 0;
    if (data.vat !== undefined  ) {
        const taxRate = data.vat/100; // 7.7% de TVA
        taxAmount = sum * taxRate;
        // if amount is not equal to taxAmount + sum return error
    }
    if (data.amount !== taxAmount + sum) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Amount is not equal to taxAmount + sum, amount: " + data.amount + " taxAmount: " + taxAmount + " sum: " + sum })
        };
    }


    



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


    // Initialisation des variables pour les calculs
    let sumTotal = 0;

    // Construction des lignes de la table avec les données
    const tableRows = data.rows.map(row => {
        // Ajouter au total
        sumTotal += parseFloat(row.total.replace('CHF ', '').replace("'", ""));
        
        return {
        columns: [
            { text: row.position, width: mm2pt(20) },
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
        { text: "Position", width: mm2pt(20) },
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

    // Ajouter les lignes de TVA et total final
    if (data.vat !== undefined  ) {
        tableRows.push(
        // Vide
        {
            columns: [
            { text: "", width: mm2pt(20) },
            { text: "", width: mm2pt(20) },
            { text: "" },
            { text: "", width: mm2pt(30) }
            ],
            padding: 5
        },
        // Ligne pour la TVA
        {
            columns: [
            { text: "", width: mm2pt(20) },
            { text: "", width: mm2pt(20) },
            { text: `TVA ${data.vat}` },
            { text: `CHF ${taxAmount.toFixed(2)}`, width: mm2pt(30) }
            ],
            padding: 5
        },
        // Ligne pour le total avec TVA
        {
            columns: [
            { text: "", width: mm2pt(20) },
            { text: "", width: mm2pt(20) },
            { text: "Total avec TVA", font: "Helvetica-Bold" },
            { text: `CHF ${(sumTotal + taxAmount).toFixed(2)}`, width: mm2pt(30), font: "Helvetica-Bold" }
            ],
            padding: 5
        }
        );
    } else {
        tableRows.push(
        {
            columns: [
            { text: "", width: mm2pt(20) },
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
            { text: "", width: mm2pt(20) },
            { text: "Total", font: "Helvetica-Bold" },
            { text: `CHF ${sumTotal.toFixed(2)}`, width: mm2pt(30), font: "Helvetica-Bold" }
            ],
            padding: 5
        }
        );
    }

    // Création de l'objet Table
    const table = new Table({
    rows: tableRows,
    width: mm2pt(170)
    });
    
    table.attachTo(pdf);

    pdf.end();

    const params = {
        Bucket: "swiss-qr-code",
        Key: "qr-bill.pdf",
        Body: stream,
        ContentType: "application/pdf"
    };

    try {
        const uploadData = await s3.upload(params).promise();

        // Générer un URL présigné
        const signedUrl = await s3.getSignedUrlPromise('getObject', {
            Bucket: params.Bucket,
            Key: params.Key,
            Expires: 60 * 5 // Lien valide pour 5 minutes
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ url: signedUrl })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify(error)
        };
    }
};
