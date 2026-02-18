import javax.xml.crypto.dsig.*;
import javax.xml.crypto.dsig.dom.DOMSignContext;
import javax.xml.crypto.dsig.keyinfo.KeyInfo;
import javax.xml.crypto.dsig.keyinfo.KeyInfoFactory;
import javax.xml.crypto.dsig.keyinfo.X509Data;
import javax.xml.crypto.dsig.spec.C14NMethodParameterSpec;
import javax.xml.crypto.dsig.spec.TransformParameterSpec;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.*;

import org.w3c.dom.Document;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;

public class XmlSigner {
    public static void main(String[] args) throws Exception {
        File baseDir = new File(System.getProperty("user.dir"));
        File xmlDir = new File(baseDir, "XML");
        File outDir = new File(baseDir, "XML Assinado");
        File certDir = new File(baseDir, "cert");

        if (!xmlDir.isDirectory()) throw new IllegalStateException("Pasta XML não encontrada: " + xmlDir.getAbsolutePath());
        if (!certDir.isDirectory()) throw new IllegalStateException("Pasta cert não encontrada: " + certDir.getAbsolutePath());
        if (!outDir.exists()) outDir.mkdirs();

        char[] password = Optional.ofNullable(System.getenv("CERT_PASSWORD")).orElse("1234").toCharArray();

        TokenReader token = new TokenReader(certDir);
        token.openKeyStore(password);
        X509Certificate cert = token.getCertificate();
        PrivateKey privateKey = token.getPrivateKey();

        XMLSignatureFactory fac = XMLSignatureFactory.getInstance("DOM");

        Reference ref = fac.newReference(
                "",
                fac.newDigestMethod(DigestMethod.SHA1, null),
                Collections.singletonList(fac.newTransform(Transform.ENVELOPED, (TransformParameterSpec) null)),
                null,
                null
        );

        SignedInfo si = fac.newSignedInfo(
                fac.newCanonicalizationMethod(CanonicalizationMethod.INCLUSIVE, (C14NMethodParameterSpec) null),
                fac.newSignatureMethod(SignatureMethod.RSA_SHA1, null),
                Collections.singletonList(ref)
        );

        KeyInfoFactory kif = fac.getKeyInfoFactory();
        List<Object> x509Content = new ArrayList<>();
        x509Content.add(cert.getSubjectX500Principal().getName());
        x509Content.add(cert);
        X509Data xd = kif.newX509Data(x509Content);
        KeyInfo ki = kif.newKeyInfo(Collections.singletonList(xd));

        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);

        File[] xmlFiles = xmlDir.listFiles((dir, name) -> name.toLowerCase().endsWith(".xml"));
        if (xmlFiles == null || xmlFiles.length == 0) throw new IllegalStateException("Nenhum XML encontrado em: " + xmlDir.getAbsolutePath());

        for (File xmlFile : xmlFiles) {
            Document doc = dbf.newDocumentBuilder().parse(new FileInputStream(xmlFile));
            DOMSignContext dsc = new DOMSignContext(privateKey, doc.getDocumentElement());
            XMLSignature signature = fac.newXMLSignature(si, ki);
            signature.sign(dsc);

            File outFile = new File(outDir, xmlFile.getName());
            try (OutputStream os = new FileOutputStream(outFile)) {
                TransformerFactory tf = TransformerFactory.newInstance();
                Transformer trans = tf.newTransformer();
                trans.transform(new DOMSource(doc), new StreamResult(os));
            }
        }

        System.out.println("Assinatura concluída. Arquivos gerados em: " + outDir.getAbsolutePath());
    }
}

class TokenReader {
    private final File certDir;
    private KeyStore keyStore;
    private String keyAlias;
    private char[] password;

    TokenReader(File certDir) {
        this.certDir = certDir;
    }

    void openKeyStore(char[] password) throws Exception {
        this.password = password;
        File pfx = findCertFile();
        if (pfx == null) throw new IllegalStateException("Nenhum arquivo .pfx ou .p12 encontrado em: " + certDir.getAbsolutePath());
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream fis = new FileInputStream(pfx)) {
            ks.load(fis, password);
        }
        this.keyStore = ks;
        this.keyAlias = findAlias(ks);
        if (this.keyAlias == null) throw new IllegalStateException("Alias do certificado não encontrado no keystore");
    }

    X509Certificate getCertificate() throws Exception {
        return (X509Certificate) keyStore.getCertificate(keyAlias);
    }

    PrivateKey getPrivateKey() throws Exception {
        return (PrivateKey) keyStore.getKey(keyAlias, password);
    }

    private File findCertFile() {
        File[] files = certDir.listFiles((dir, name) ->
                name.toLowerCase().endsWith(".pfx") || name.toLowerCase().endsWith(".p12"));
        if (files == null || files.length == 0) return null;
        Arrays.sort(files, Comparator.comparing(File::getName));
        return files[0];
    }

    private String findAlias(KeyStore ks) throws Exception {
        Enumeration<String> aliases = ks.aliases();
        while (aliases.hasMoreElements()) {
            String a = aliases.nextElement();
            if (ks.isKeyEntry(a)) return a;
        }
        return null;
    }
}
