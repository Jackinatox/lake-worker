import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Tailwind,
} from '@react-email/components';
import * as React from 'react';
import { EmailFooter } from './EmailFooter';

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
  supportText?: string;
  signature?: string;
}

export function EmailLayout({
  preview,
  children,
  supportText,
  signature,
}: EmailLayoutProps): React.ReactElement {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body
          style={{
            margin: 0,
            padding: '8px 4px',
          }}
        >
          <Container
            style={{
              margin: '0 auto',
              width: '100%',
              maxWidth: '620px',
              padding: 0,
            }}
          >
            {children}
            <EmailFooter supportText={supportText} signature={signature} />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
