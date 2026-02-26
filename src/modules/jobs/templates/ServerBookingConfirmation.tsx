import { Button, Heading, Img, Section, Text } from '@react-email/components';
import * as React from 'react';
import { APP_URL } from 'src/lib/GlobalConsstants';
import { EmailLayout } from './components/EmailLayout';
import formatVCores from 'src/lib/general/formatVCores';

export interface ServerBookingConfirmationTemplateProps {
  userName: string;
  gameName: string;
  gameImageUrl: string;
  serverName: string;
  ramMB: number;
  cpuVCores: number;
  diskMB: number;
  location: string;
  price: number;
  expiresAt: Date;
  serverUrl: string;
  isFreeServer: boolean;
}

const formatPrice = (cents: number) => {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
};

export default function ServerBookingConfirmationTemplate({
  userName,
  gameName,
  gameImageUrl,
  serverName,
  ramMB,
  cpuVCores,
  diskMB,
  location,
  price,
  expiresAt,
  serverUrl,
  isFreeServer,
}: ServerBookingConfirmationTemplateProps): React.ReactElement {
  const formattedExpiresAt = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(expiresAt);

  const previewText = `Dein ${gameName} Server wurde erfolgreich gebucht!`;
  const actionLabel = isFreeServer ? 'Server verlängern' : 'Server verwalten';

  return (
    <EmailLayout preview={previewText}>
      <Heading className="m-0 text-2xl font-bold text-slate-900">
        Server erfolgreich gebucht! 🎉
      </Heading>

      <Text className="mt-6 text-base leading-6 text-slate-600">
        Hallo {userName},
      </Text>

      <Text className="mt-4 text-base leading-6 text-slate-600">
        Vielen Dank für deine Buchung! Dein {gameName} Server wurde erfolgreich
        erstellt und wird gerade für dich eingerichtet.
      </Text>

      <Section className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <table
          role="presentation"
          width="100%"
          cellPadding="0"
          cellSpacing="0"
          className="border-collapse"
        >
          <tbody>
            <tr>
              <td className="w-[72px] min-w-[72px] pr-3.5 align-middle">
                <Img
                  src={gameImageUrl}
                  alt={`${gameName} Icon`}
                  width="72"
                  height="72"
                  className="block max-w-[72px] rounded-xl"
                />
              </td>
              <td className="align-middle text-left">
                <Text className="m-0 text-lg font-semibold text-slate-900">
                  {gameName}
                </Text>
                <Text className="mt-1.5 text-base text-slate-600">
                  {serverName}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section className="mt-6">
        <Heading className="mb-2 text-lg font-semibold text-slate-900">
          Server Details
        </Heading>
        <table className="w-full" cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">Server Name:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {serverName}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">Spiel:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {gameName}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">RAM:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {(ramMB / 1024).toFixed(1)} GB
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">CPU:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {formatVCores(cpuVCores)}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">Speicher:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {(diskMB / 1024).toFixed(1)} GB
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">
                Performance-Level:
              </td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {location}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-sm text-slate-500">Läuft bis:</td>
              <td className="py-1.5 text-right text-sm font-semibold text-slate-900">
                {formattedExpiresAt}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      {isFreeServer ? (
        <Section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <Text className="m-0 text-base font-semibold text-slate-900">
            Kostenloser Server
          </Text>
          <Text className="mt-2 text-sm leading-5 text-slate-700">
            Dein kostenloser Server kann aktuell nur in der Laufzeit verlängert
            werden. Ein Upgrade auf einen bezahlten Server wird künftig
            verfügbar sein.
          </Text>
          {/* TODO: Add paid upgrade CTA once the upgrade flow is available. */}
        </Section>
      ) : (
        <Section className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <table className="w-full" cellPadding="0" cellSpacing="0">
            <tbody>
              <tr>
                <td className="text-base font-semibold text-slate-900">
                  Gesamtbetrag:
                </td>
                <td className="text-right text-xl font-bold text-slate-900">
                  {formatPrice(price)}
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      <Section className="mt-6">
        <Button
          href={serverUrl}
          className="inline-block rounded-full bg-slate-900 px-6 py-3 text-base font-semibold text-white no-underline"
        >
          {actionLabel}
        </Button>
      </Section>

      <Text className="mt-4 text-base leading-6 text-slate-600">
        Dein Server wird gerade eingerichtet, du kannst dich gleich verbinden.
      </Text>

      <Text className="mt-4 text-base leading-6 text-slate-600">
        Bei Fragen oder Problemen steht dir unser{' '}
        <a href={`${APP_URL}/support`} className="text-slate-900 underline">
          Support-Team
        </a>{' '}
        jederzeit zur Verfügung.
      </Text>
    </EmailLayout>
  );
}
