import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { toDataURL } from 'qrcode';

/**
 * Everything printed on a certificate comes from the row's own snapshot
 * columns, never from a live join: a club renamed or rebranded after
 * issuance must not change a document somebody already holds (spec 5.1).
 */
export interface CertificateDocument {
  serialNumber: string;
  verificationCode: string;
  holderName: string;
  eventTitle: string;
  clubName: string;
  clubLogoUrl: string;
  issuedAt: Date;
  /** From the event, also snapshotted in effect: both are printed as given. */
  certificateTitle: string;
  signatory: string | null;
  verifyUrl: string;
}

const styles = StyleSheet.create({
  page: { padding: 56, fontSize: 11, color: '#1c1917' },
  frame: { border: '1pt solid #1c1917', flexGrow: 1, padding: 40, justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, objectFit: 'contain' },
  club: { fontSize: 13, letterSpacing: 1 },
  title: { fontSize: 26, marginBottom: 6 },
  lede: { fontSize: 11, color: '#57534e' },
  holder: { fontSize: 32, marginTop: 18, marginBottom: 10 },
  event: { fontSize: 16, marginBottom: 6 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  meta: { fontSize: 9, color: '#57534e', lineHeight: 1.6 },
  code: { fontSize: 10, letterSpacing: 1 },
  qr: { width: 84, height: 84 },
});

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Renders the document to PDF bytes. Called on the first download of a
 * certificate and never again — `pdfUrl` is filled in afterwards, which is
 * what keeps issuance cheap enough to run inline (spec 7.6).
 */
export async function renderCertificate(doc: CertificateDocument): Promise<Buffer> {
  // A data URI rather than a fetched image: the QR is generated here, and a
  // PDF renderer reaching out to the network mid-render is a request that
  // can hang a download.
  const qr = await toDataURL(doc.verifyUrl, { margin: 0, errorCorrectionLevel: 'M' });

  return renderToBuffer(
    <Document title={doc.serialNumber} author={doc.clubName}>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.frame}>
          <View style={styles.head}>
            {/* A club always has a logo (spec 5.1), and this is the URL the
                row snapshotted, not the club's current one. */}
            <Image src={doc.clubLogoUrl} style={styles.logo} />
            <Text style={styles.club}>{doc.clubName}</Text>
          </View>

          <View>
            <Text style={styles.title}>{doc.certificateTitle}</Text>
            <Text style={styles.lede}>This is to certify that</Text>
            <Text style={styles.holder}>{doc.holderName}</Text>
            <Text style={styles.lede}>attended</Text>
            <Text style={styles.event}>{doc.eventTitle}</Text>
            <Text style={styles.lede}>on {DATE.format(doc.issuedAt)}</Text>
          </View>

          <View style={styles.foot}>
            <View style={styles.meta}>
              {doc.signatory ? <Text>{doc.signatory}</Text> : null}
              <Text>Serial {doc.serialNumber}</Text>
              <Text style={styles.code}>{doc.verificationCode}</Text>
              <Text>{doc.verifyUrl}</Text>
            </View>
            <Image src={qr} style={styles.qr} />
          </View>
        </View>
      </Page>
    </Document>,
  );
}
