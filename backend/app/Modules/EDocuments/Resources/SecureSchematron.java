import java.io.File;
import java.util.TimeZone;
import javax.xml.XMLConstants;
import javax.xml.parsers.SAXParserFactory;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerException;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.sax.SAXSource;
import javax.xml.transform.stream.StreamResult;
import javax.xml.transform.stream.StreamSource;
import org.xml.sax.InputSource;
import org.xml.sax.XMLReader;

/** Runs only the packaged, hash-verified stylesheet; URI and entity access is denied. */
class SecureSchematron {
    public static void main(String[] args) throws Exception {
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Istanbul"));
        if (args.length != 4 || !(args[3].equals("efatura") || args[3].equals("earchive"))) {
            throw new IllegalArgumentException("Expected input, stylesheet, result and fixed document mode.");
        }
        TransformerFactory factory = TransformerFactory.newInstance("net.sf.saxon.TransformerFactoryImpl", SecureSchematron.class.getClassLoader());
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_STYLESHEET, "");
        factory.setURIResolver((href, base) -> { throw new TransformerException("External URI access is disabled."); });
        Transformer transformer = factory.newTransformer(new StreamSource(new File(args[1])));
        transformer.setURIResolver((href, base) -> { throw new TransformerException("External URI access is disabled."); });
        transformer.setParameter("type", args[3]);
        SAXParserFactory parsers = SAXParserFactory.newInstance();
        parsers.setNamespaceAware(true);
        parsers.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        parsers.setFeature("http://xml.org/sax/features/external-general-entities", false);
        parsers.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        parsers.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        XMLReader reader = parsers.newSAXParser().getXMLReader();
        reader.setEntityResolver((publicId, systemId) -> { throw new org.xml.sax.SAXException("External entities are disabled."); });
        InputSource input = new InputSource(new File(args[0]).toURI().toString());
        transformer.transform(new SAXSource(reader, input), new StreamResult(new File(args[2])));
    }
}
