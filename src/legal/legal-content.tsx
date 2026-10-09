import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export const LEGAL_BUSINESS = "Allen Express, LLC";
export const LEGAL_PHONE = "312-899-6718";
export const LEGAL_PHONE_HREF = "tel:+13128996718";
export const LEGAL_UPDATED = { dateTime: "2026-10-06", label: "October 6, 2026" };
export const SMS_OPT_IN_CONFIRMATION = "Allen Express, LLC (dba Allan Limousine): You are now opted in to SMS updates. Msg frequency varies. Msg & data rates may apply. Reply HELP for assistance, or STOP to opt out.";
export const SMS_HELP_CONFIRMATION = "Allen Express, LLC support: For assistance, visit allanlimousine.com or call 312-899-6718. Reply STOP to opt out. Msg & Data Rates May Apply";
export type LegalSection = { id: string; title: string; content: ReactNode; highlight?: boolean };
export type LegalDocument = { title: string; introduction: string; sections: LegalSection[]; updated?: { dateTime: string; label: string } };
const contact = <a href={LEGAL_PHONE_HREF}>{LEGAL_PHONE}</a>;

export const privacyDocument: LegalDocument = {
  title: "Privacy Policy",
  introduction: "Your privacy matters to us. This policy explains how Allan Limousine collects, uses, and protects information when you visit our website, book transportation, or communicate with our team.",
  sections: [
    { id: "who-we-are", title: "Who we are", content: <p>Allan Limousine is operated by Allen Express, LLC, a business registered in Illinois, United States. This policy applies to our website, customer accounts, reservations, trip-related services, and communications. For privacy questions, call {contact}.</p> },
    { id: "information-collected", title: "Information we collect", content: <>
      <p>We collect information you provide and information needed to deliver and protect our services, including:</p>
      <ul><li><strong>Contact and account details:</strong> name, email address, telephone number, and account credentials.</li>
      <li><strong>Reservation and trip details:</strong> pickup and destination addresses, travel dates and times, passenger counts, vehicle preferences, flight details, and any instructions you choose to provide.</li>
      <li><strong>Payment and transaction information:</strong> fare estimates, payment authorization and transaction references, and payment status. Card details are processed by Stripe; our application does not store your full card number or card security code.</li>
      <li><strong>Communications and consent records:</strong> messages, service inquiries, SMS opt-in and opt-out information, and delivery status.</li>
      <li><strong>Technical and service information:</strong> IP address, browser and device information, session information, and security or troubleshooting logs. Trip tracking may include a chauffeur's location when location sharing is enabled.</li></ul>
    </> },
    { id: "information-use", title: "How we use information", content: <>
      <p>We use information to arrange and fulfill reservations, coordinate chauffeurs and pickups, estimate routes and fares, process payment authorizations and payments, provide customer support, and send permitted service-related communications.</p>
      <p>We also use information to manage accounts, prevent fraud, secure our systems, maintain operational records, and comply with applicable legal obligations. We do not sell your personal information.</p>
    </> },
    { id: "sms-privacy", title: "Mobile information & SMS privacy", highlight: true, content: <>
      <p><strong>Mobile information will not be shared with third parties or affiliates for marketing or promotional purposes. SMS opt-in data and consent will not be shared with third parties or affiliates for marketing or promotional purposes.</strong></p>
      <p>We use mobile numbers and SMS consent records only for the communications you authorize, service coordination, and honoring your messaging choices. Limited information may be processed by messaging providers solely to deliver and support our SMS program, subject to confidentiality and service-use restrictions—not for their own marketing.</p>
      <p>Our other information-sharing provisions do not authorize the sale, rental, or disclosure of SMS opt-in data or consent for another party's marketing. You can withdraw SMS consent by replying <strong>STOP</strong>. For help, reply <strong>HELP</strong> or call {contact}. See our <Link to="/terms#sms-program">SMS terms</Link> for frequency and rate disclosures.</p>
    </> },
    { id: "information-sharing", title: "Service providers & limited disclosures", content: <>
      <p>We disclose only information reasonably needed to fulfill a service or support our operations. Relevant providers include:</p>
      <ul><li><strong>Stripe:</strong> payment processing and authorization.</li><li><strong>Twilio:</strong> SMS delivery, inbound messages, and messaging status.</li><li><strong>Google Maps Platform:</strong> address lookup, mapping, and route calculations.</li><li><strong>Aviationstack:</strong> flight-status lookup using flight details.</li><li><strong>SendGrid:</strong> service-related email delivery.</li></ul>
      <p>Chauffeurs and authorized staff receive the trip and contact details needed to coordinate your transportation. Providers process information under their own applicable privacy terms and our service arrangements.</p>
      <p>We may disclose information when required by law or reasonably necessary to protect safety, investigate fraud, or defend legal rights. These limited operational or legal disclosures do not permit marketing use of your mobile information or SMS consent data.</p>
    </> },
    { id: "cookies", title: "Cookies & local storage", content: <p>Our website uses cookies and browser storage for functions such as sign-in sessions, security, and remembering application preferences. Third-party features such as maps and payment forms may use their own cookies or similar technologies. You can manage browser storage and cookies through your browser settings; disabling them may prevent some features from working.</p> },
    { id: "retention-security", title: "Retention & security", content: <>
      <p>We retain information as needed to provide services, maintain business and payment records, document consent and opt-out requests, resolve disputes, and meet legal obligations. Retention depends on the type of information and its purpose; some records may need to remain after an account or reservation ends.</p>
      <p>We use safeguards designed to limit unauthorized access, including staff access controls and protected account credentials. No internet transmission or storage system is completely secure, and we cannot guarantee absolute security.</p>
    </> },
    { id: "privacy-choices", title: "Your choices & privacy requests", content: <>
      <p>You may request access to, correction of, or deletion of your personal information by calling {contact}. We may verify your identity before responding. Requests are handled subject to applicable law and any information we must retain for legal, security, or operational reasons.</p>
      <p>SMS participation is voluntary and is not a condition of purchasing transportation. Reply <strong>STOP</strong> to unsubscribe from SMS; unsubscribing does not itself cancel a reservation. Contact us separately about changes to your transportation.</p>
    </> },
    { id: "children", title: "Children's privacy", content: <p>Our website and booking accounts are intended for adults arranging transportation. We do not knowingly collect personal information directly from children under 13. If you believe a child has submitted personal information without appropriate authorization, call {contact} so we can investigate and address it.</p> },
    { id: "policy-updates", title: "Changes & contact", content: <p>We may update this policy to reflect changes to our services or legal requirements. Updates will appear on this page with a revised date, and we will provide additional notice when required by law. For questions about this policy or your information, contact Allen Express, LLC, operating Allan Limousine, at {contact}.</p> },
  ],
};

export const termsDocument: LegalDocument = {
  title: "Terms and Conditions",
  introduction: "Please review these terms before using our website or arranging transportation. They explain our services, reservation responsibilities, and SMS program.",
  updated: { dateTime: "2026-10-08", label: "October 8, 2026" },
  sections: [
    { id: "agreement", title: "Agreement & operator", content: <p>These terms govern your use of Allan Limousine's website and services, operated by Allen Express, LLC, registered in Illinois, United States. By using the website or booking services, you agree to these terms and any specific conditions disclosed and accepted for your reservation. If you do not agree, do not use the services. Our <Link to="/privacy">Privacy Policy</Link> explains our information practices.</p> },
    { id: "reservations", title: "Reservations & customer responsibilities", content: <>
      <p>Provide accurate contact, pickup, destination, passenger, and flight information. You must be at least 18 or otherwise legally able to enter into a booking agreement. If booking for another passenger, you must have authority to provide their details and arrange the trip.</p>
      <p>A fare estimate or submitted request is not, by itself, a guarantee of vehicle availability. Review the reservation confirmation and notify us promptly of incorrect details or changes. Availability, vehicle assignment, and pickup arrangements depend on the confirmed reservation.</p>
      <p>Keep account credentials secure and report suspected unauthorized activity. Passengers must follow lawful chauffeur instructions and applicable safety requirements. Illegal activity, threats, harassment, and unsafe conduct are prohibited.</p>
    </> },
    { id: "fares-payments", title: "Fares & payments", content: <>
      <p>Review the fare and applicable charges shown or quoted before confirming your booking. Changes to the itinerary, waiting time, tolls, or additional services may affect the price where disclosed and agreed. Contact us if you need clarification before proceeding.</p>
      <p>Payments are processed through Stripe. Where the booking flow uses a card authorization hold, the disclosed amount is authorized at booking and captured when the ride is completed. Your bank controls how pending authorizations appear and how quickly a released hold becomes available. A displayed estimate is not a promise that an altered itinerary has the same price.</p>
    </> },
    { id: "changes-cancellations", title: "Changes, cancellations & refunds", content: <p>Call {contact} as soon as possible to request a change or cancellation. Availability and any cancellation, no-show, waiting-time, or refund conditions depend on the terms disclosed for your particular reservation and applicable law. These website terms do not create an undisclosed fee or guarantee a refund. If no specific cancellation conditions were provided, contact us for clarification before confirming the booking. An SMS opt-out does not cancel a ride.</p> },
    { id: "sms-program", title: "SMS program terms", highlight: true, content: <>
      <p><strong>Program:</strong> Allan Limousine service-related SMS may include reservation confirmations, pickup reminders, chauffeur or trip updates, and responses to customer inquiries. By opting in, you authorize these messages at the mobile number you provide, including messages sent using automated technology where applicable. SMS consent is not a condition of purchasing services.</p>
      <ul><li><strong>Message frequency:</strong> Message frequency varies based on your reservations, trip activity, and communications with our team.</li>
      <li><strong>Rates:</strong> Message and data rates may apply. Your mobile carrier's messaging and data charges are your responsibility; check your plan for details.</li>
      <li><strong>Opt out:</strong> Reply <strong>STOP</strong> to any Allan Limousine SMS to unsubscribe. You may receive a final opt-out confirmation, after which further program messages will stop unless you opt in again. Opting out does not cancel a reservation.</li>
      <li><strong>Help:</strong> Reply <strong>HELP</strong> for assistance, or call our support team at {contact}.</li>
      <li><strong>Rejoin:</strong> Reply <strong>START</strong> to opt back in where supported, or contact us for assistance.</li></ul>
      <p><strong>Opt-In Confirmation Message:</strong> {SMS_OPT_IN_CONFIRMATION}</p>
      <p><strong>Help Confirmation Message:</strong> {SMS_HELP_CONFIRMATION}</p>
      <p>Use only a number you own or are authorized to use, and notify us if it changes. Delivery is subject to carrier and network availability and is not guaranteed. Carriers are not liable for delayed or undelivered messages. Do not rely on SMS for emergencies or time-critical changes; contact our team directly.</p>
      <p>Mobile information and SMS opt-in data will not be shared with third parties or affiliates for marketing purposes. See the <Link to="/privacy#sms-privacy">SMS privacy section</Link> of our Privacy Policy.</p>
    </> },
    { id: "service-availability", title: "Service availability & trip updates", content: <p>We aim to provide dependable transportation, but traffic, weather, road restrictions, flight changes, and other circumstances can affect travel times. Website estimates, flight information, maps, and tracking updates are informational and may be delayed or unavailable. They do not guarantee arrival times or replace direct confirmation with our team. Contact {contact} for material trip changes.</p> },
    { id: "website-use", title: "Website use & intellectual property", content: <p>Use the website lawfully. Do not attempt unauthorized access, interfere with service, misuse another person's account or details, or submit fraudulent reservations. Allan Limousine's branding, website content, and design are owned by or licensed to the operator and may not be commercially copied without permission. Links and third-party tools may be subject to their providers' separate terms.</p> },
    { id: "liability", title: "Liability & legal rights", content: <p>To the extent permitted by applicable law, we are not responsible for indirect or consequential losses arising solely from website outages, inaccurate third-party information, or circumstances beyond our reasonable control. Nothing in these terms excludes liability that cannot lawfully be excluded, limits statutory consumer rights, or excuses our own obligations under an accepted reservation.</p> },
    { id: "governing-law", title: "Governing law", content: <p>These terms are governed by applicable United States law and the laws of Illinois, without limiting mandatory protections available under applicable law. Contact us first with a concern so we can try to resolve it. These terms do not require mandatory arbitration or waive rights that cannot lawfully be waived.</p> },
    { id: "terms-contact", title: "Updates & contact", content: <p>We may revise these terms by posting an updated version and date. Material changes will be communicated where required by law and will not retroactively change an accepted reservation without an appropriate legal basis or agreement. For reservation, SMS, or terms-related questions, contact Allen Express, LLC, operating Allan Limousine, at {contact}.</p> },
  ],
};
