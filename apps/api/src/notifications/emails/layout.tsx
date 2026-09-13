import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

/**
 * The shell every notification email renders inside. Inline styles only:
 * an email client strips a stylesheet, and half of them strip a style
 * block too, so the tokens the product uses on screen cannot travel here.
 */
const page = { backgroundColor: '#f6f5f3', fontFamily: 'ui-sans-serif, system-ui, sans-serif' };
const card = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  margin: '24px auto',
  maxWidth: '560px',
  padding: '32px',
};
const headingStyle = { color: '#171512', fontSize: '20px', lineHeight: '28px', margin: '0 0 16px' };
const textStyle = { color: '#3b3833', fontSize: '15px', lineHeight: '24px', margin: '0 0 12px' };
const actionStyle = { color: '#1f4fd8', fontSize: '15px' };

export interface LayoutProps {
  /** The one-line summary an inbox shows beside the subject. */
  preview: string;
  heading: string;
  /** Where the "open it" link points. Absolute, because an email has no origin. */
  actionUrl: string;
  actionLabel: string;
  children: ReactNode;
}

export function EmailLayout({ preview, heading, actionUrl, actionLabel, children }: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={page}>
        <Container style={card}>
          <Heading style={headingStyle}>{heading}</Heading>
          {children}
          <Section>
            <Link href={actionUrl} style={actionStyle}>
              {actionLabel}
            </Link>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** A paragraph in the layout's type scale, so no template restates it. */
export function EmailText({ children }: { children: ReactNode }) {
  return <Text style={textStyle}>{children}</Text>;
}
