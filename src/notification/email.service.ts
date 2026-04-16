import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendAlertEmailParams {
  to: string;
  monitorName: string;
  monitorUrl: string;
  type: 'DOWN' | 'RECOVERY';
  triggeredAt: Date;
  responseTimeMs?: number;
  errorMessage?: string;
  dashboardUrl: string;
}

function formatUtcDate(date: Date): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day}, ${year} at ${hours}:${minutes} UTC`;
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function wrapLayout(body: string, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pulse Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:${FONT_STACK};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:600px;width:100%;background-color:#ffffff;
                      border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
          ${body}
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e7eb;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                You are receiving this because you have email alerts enabled on Pulse.<br>
                <a href="${appUrl}/dashboard" style="color:#6b7280;text-decoration:underline;">
                  Manage your alert settings
                </a>
              </p>
            </td>
          </tr>
        </table>
        <!-- Pulse branding -->
        <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">
          Sent by <a href="${appUrl}" style="color:#6b7280;text-decoration:none;">Pulse</a>
          &mdash; Uptime Monitoring
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── DOWN template ────────────────────────────────────────────────────────────

function buildDownHtml(params: SendAlertEmailParams, appUrl: string): string {
  const { monitorName, monitorUrl, triggeredAt, errorMessage, dashboardUrl } = params;
  const formattedTime = formatUtcDate(triggeredAt);

  const errorRow = errorMessage
    ? `<tr>
        <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;width:130px;">
          Error
        </td>
        <td style="padding:6px 0;font-size:13px;color:#dc2626;font-weight:500;
                   word-break:break-word;">
          ${errorMessage}
        </td>
      </tr>`
    : '';

  const body = `
  <!-- Header -->
  <tr>
    <td style="background-color:#ef4444;padding:36px 32px;text-align:center;">
      <div style="font-size:52px;line-height:1;margin-bottom:12px;">🔴</div>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
        Monitor Down
      </h1>
      <p style="margin:8px 0 0;color:#fecaca;font-size:14px;">
        ${monitorName} is not responding
      </p>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <!-- Details card -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#fef2f2;border:1px solid #fecaca;
                    border-radius:6px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;
                           vertical-align:top;width:130px;">
                  Monitor
                </td>
                <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:600;">
                  ${monitorName}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">
                  URL
                </td>
                <td style="padding:6px 0;font-size:13px;word-break:break-all;">
                  <a href="${monitorUrl}" style="color:#3b82f6;text-decoration:none;">
                    ${monitorUrl}
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">
                  Detected at
                </td>
                <td style="padding:6px 0;font-size:13px;color:#111827;">
                  ${formattedTime}
                </td>
              </tr>
              ${errorRow}
            </table>
          </td>
        </tr>
      </table>
      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td align="center">
            <a href="${dashboardUrl}"
               style="display:inline-block;background-color:#ef4444;color:#ffffff;
                      text-decoration:none;font-size:15px;font-weight:600;
                      padding:12px 36px;border-radius:6px;letter-spacing:0.1px;">
              View Dashboard
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

  return wrapLayout(body, appUrl);
}

function buildDownText(params: SendAlertEmailParams): string {
  const { monitorName, monitorUrl, triggeredAt, errorMessage, dashboardUrl } = params;
  return [
    `ALERT: ${monitorName} is DOWN`,
    '',
    `Monitor: ${monitorName}`,
    `URL:     ${monitorUrl}`,
    `Time:    ${formatUtcDate(triggeredAt)}`,
    errorMessage ? `Error:   ${errorMessage}` : '',
    '',
    `View your dashboard: ${dashboardUrl}`,
    '',
    '---',
    'You are receiving this because you have email alerts enabled on Pulse.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

// ─── RECOVERY template ────────────────────────────────────────────────────────

function buildRecoveryHtml(params: SendAlertEmailParams, appUrl: string): string {
  const { monitorName, monitorUrl, triggeredAt, responseTimeMs, dashboardUrl } = params;
  const formattedTime = formatUtcDate(triggeredAt);

  const latencyRow =
    responseTimeMs === undefined
      ? ''
      : `<tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;
                     vertical-align:top;width:130px;">
            Response time
          </td>
          <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:600;">
            ${responseTimeMs} ms
          </td>
        </tr>`;

  const body = `
  <!-- Header -->
  <tr>
    <td style="background-color:#16a34a;padding:36px 32px;text-align:center;">
      <div style="font-size:52px;line-height:1;margin-bottom:12px;">🟢</div>
      <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
        Monitor Recovered
      </h1>
      <p style="margin:8px 0 0;color:#bbf7d0;font-size:14px;">
        ${monitorName} is back online
      </p>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;">
      <!-- Details card -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background-color:#f0fdf4;border:1px solid #bbf7d0;
                    border-radius:6px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;
                           vertical-align:top;width:130px;">
                  Monitor
                </td>
                <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:600;">
                  ${monitorName}
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">
                  URL
                </td>
                <td style="padding:6px 0;font-size:13px;word-break:break-all;">
                  <a href="${monitorUrl}" style="color:#3b82f6;text-decoration:none;">
                    ${monitorUrl}
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-size:13px;color:#6b7280;vertical-align:top;">
                  Recovered at
                </td>
                <td style="padding:6px 0;font-size:13px;color:#111827;">
                  ${formattedTime}
                </td>
              </tr>
              ${latencyRow}
            </table>
          </td>
        </tr>
      </table>
      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td align="center">
            <a href="${dashboardUrl}"
               style="display:inline-block;background-color:#16a34a;color:#ffffff;
                      text-decoration:none;font-size:15px;font-weight:600;
                      padding:12px 36px;border-radius:6px;letter-spacing:0.1px;">
              View Dashboard
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

  return wrapLayout(body, appUrl);
}

function buildRecoveryText(params: SendAlertEmailParams): string {
  const { monitorName, monitorUrl, triggeredAt, responseTimeMs, dashboardUrl } = params;
  return [
    `RECOVERY: ${monitorName} is back UP`,
    '',
    `Monitor:       ${monitorName}`,
    `URL:           ${monitorUrl}`,
    `Recovered at:  ${formatUtcDate(triggeredAt)}`,
    responseTimeMs === undefined ? '' : `Response time: ${responseTimeMs} ms`,
    '',
    `View your dashboard: ${dashboardUrl}`,
    '',
    '---',
    'You are receiving this because you have email alerts enabled on Pulse.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;
  private readonly fromAddress: string;
  private readonly appUrl: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    this.resend = new Resend(apiKey);
    this.fromAddress = process.env.EMAIL_FROM ?? 'alerts@pulsee.website';
    this.appUrl = process.env.APP_URL ?? 'https://pulsee.website';

    // Log only first 4 characters of the key — never the full secret.
    this.logger.log(`EmailService ready — key=${apiKey.slice(0, 4)}**** from=${this.fromAddress}`);
  }

  async sendAlertEmail(params: SendAlertEmailParams): Promise<void> {
    const { to, type, monitorName } = params;

    const subject =
      type === 'DOWN'
        ? `🔴 ${monitorName} is DOWN — Pulse Alert`
        : `🟢 ${monitorName} is back UP — Pulse Alert`;

    const html =
      type === 'DOWN' ? buildDownHtml(params, this.appUrl) : buildRecoveryHtml(params, this.appUrl);

    const text = type === 'DOWN' ? buildDownText(params) : buildRecoveryText(params);

    const { data, error } = await this.resend.emails.send({
      from: `Pulse Alerts <${this.fromAddress}>`,
      to: [to],
      subject,
      html,
      text,
    });

    if (error) {
      throw new Error(
        `Resend delivery failed for ${to} (monitor="${monitorName}"): ${error.message}`,
      );
    }

    this.logger.log(`Email sent — id=${data?.id} to=${to} type=${type} monitor="${monitorName}"`);
  }
}
