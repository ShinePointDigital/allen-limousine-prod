import { Link } from "react-router-dom";
import { SMS_CONSENT_AGREEMENT, SMS_CONSENT_DISCLOSURE } from "../shared/sms-consent";

export function ReservationSmsConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <fieldset className="reservation-sms-consent">
    <legend>SMS notifications <span>Optional</span></legend>
    <label className="reservation-sms-consent-check">
      <input type="checkbox" name="smsConsent" checked={checked} onChange={event => onChange(event.target.checked)} aria-describedby="sms-consent-disclosure" />
      <span>{SMS_CONSENT_AGREEMENT}</span>
    </label>
    <p id="sms-consent-disclosure">{SMS_CONSENT_DISCLOSURE}</p>
    <p className="reservation-sms-consent-links"><Link to="/terms#sms-program" target="_blank" rel="noopener noreferrer" aria-label="Terms and Conditions (opens in a new tab)">Terms and Conditions</Link><span aria-hidden="true">·</span><Link to="/privacy#sms-privacy" target="_blank" rel="noopener noreferrer" aria-label="Privacy Policy (opens in a new tab)">Privacy Policy</Link></p>
  </fieldset>;
}
