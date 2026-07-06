import React from "react";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHome, faArrowRight } from "@fortawesome/free-solid-svg-icons";

const THEMES = {
  notFound: {
    background: "bg-gray-900",
    orbPrimary: "bg-blue-600",
    orbSecondary: "bg-cyan-600",
    headerGradient: "bg-blue-600",
    subtitle: "text-blue-100",
    primaryButton: "bg-blue-600 hover:bg-blue-700",
    accentText: "theme-accent-text hover:opacity-80",
    bulletAccent: "theme-accent-text",
    tones: {
      primary: {
        panel: "theme-badge-soft",
        icon: "theme-accent-text",
        link: "theme-accent-text hover:opacity-80",
      },
      secondary: {
        panel: "bg-cyan-100",
        icon: "text-cyan-600",
        link: "text-cyan-600 hover:text-cyan-700",
      },
    },
  },
  serverError: {
    background: "bg-gray-900",
    orbPrimary: "bg-red-600",
    orbSecondary: "bg-orange-600",
    headerGradient: "bg-red-600",
    subtitle: "text-red-100",
    primaryButton: "bg-red-600 hover:bg-red-700",
    accentText: "text-red-600 hover:text-red-700",
    bulletAccent: "text-red-600",
    tones: {
      primary: {
        panel: "bg-red-100",
        icon: "text-red-600",
        link: "text-red-600 hover:text-red-700",
      },
      secondary: {
        panel: "bg-orange-100",
        icon: "text-orange-600",
        link: "text-orange-600 hover:text-orange-700",
      },
    },
  },
};

function SupportLink({ card, tone }) {
  const linkClass = `${tone.link} font-semibold text-sm flex items-center justify-center transition`;

  if (card.href.startsWith("mailto:")) {
    return (
      <a href={card.href} className={linkClass}>
        {card.linkLabel}
        <FontAwesomeIcon icon={faArrowRight} className="ml-2 text-xs" />
      </a>
    );
  }

  return (
    <Link href={card.href} className={linkClass}>
      {card.linkLabel}
      <FontAwesomeIcon icon={faArrowRight} className="ml-2 text-xs" />
    </Link>
  );
}

export default function FatalState({
  theme,
  code,
  icon,
  title,
  subtitle,
  description,
  details,
  primaryActionLabel = "Back to Dashboard",
  primaryActionHref = "/",
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionIconClassName = "rotate-180",
  supportHeading,
  supportCards = [],
  extraSection,
  footer,
  quickLinks = [],
}) {
  const activeTheme = THEMES[theme];

  return (
    <div
      className={`min-h-screen ${activeTheme.background} flex items-center justify-center p-4`}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          className={`absolute -top-40 -right-40 h-80 w-80 rounded-full ${activeTheme.orbPrimary} mix-blend-multiply opacity-20 blur-3xl filter`}
        ></div>
        <div
          className={`absolute -bottom-40 -left-40 h-80 w-80 rounded-full ${activeTheme.orbSecondary} mix-blend-multiply opacity-20 blur-3xl filter`}
        ></div>
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div className={`${activeTheme.headerGradient} px-6 py-12 sm:px-8 sm:py-16`}>
            <div className="mb-6 flex justify-center">
              <div className="text-5xl font-bold text-white sm:text-6xl">
                <FontAwesomeIcon icon={icon} className="mr-4" />
                {code}
              </div>
            </div>
            <h1 className="text-center text-2xl font-bold text-white sm:text-3xl">
              {title}
            </h1>
            <p className={`mt-2 text-center text-sm sm:text-base ${activeTheme.subtitle}`}>
              {subtitle}
            </p>
          </div>

          <div className="px-6 py-12 sm:px-8 sm:py-16">
            <div className="mb-12 text-center">
              <div className="mb-4 text-base leading-relaxed text-gray-600 sm:text-lg">
                {description}
              </div>
              {details ? <div>{details}</div> : null}
            </div>

            <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Link
                href={primaryActionHref}
                className={`flex items-center justify-center rounded-lg px-6 py-3 font-semibold text-white transition duration-300 hover:scale-105 ${activeTheme.primaryButton}`}
              >
                <FontAwesomeIcon icon={faHome} className="mr-2" />
                {primaryActionLabel}
              </Link>
              <button
                onClick={onSecondaryAction}
                className="flex items-center justify-center rounded-lg bg-gray-200 px-6 py-3 font-semibold text-gray-800 transition duration-300 hover:bg-gray-300"
              >
                <FontAwesomeIcon
                  icon={faArrowRight}
                  className={`mr-2 ${secondaryActionIconClassName}`}
                />
                {secondaryActionLabel}
              </button>
            </div>

            <div className="border-t border-gray-200 pt-12">
              <h3 className="mb-8 text-center text-lg font-bold text-gray-900 sm:text-xl">
                {supportHeading}
              </h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {supportCards.map((card) => {
                  const tone = activeTheme.tones[card.tone || "primary"];

                  return (
                    <div
                      key={`${card.title}-${card.linkLabel}`}
                      className="flex flex-col items-center text-center"
                    >
                      <div
                        className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${tone.panel}`}
                      >
                        <FontAwesomeIcon
                          icon={card.icon}
                          className={`text-xl ${tone.icon}`}
                        />
                      </div>
                      <h4 className="mb-2 font-semibold text-gray-900">{card.title}</h4>
                      <p className="mb-3 text-sm text-gray-600">{card.description}</p>
                      <SupportLink card={card} tone={tone} />
                    </div>
                  );
                })}
              </div>
            </div>

            {quickLinks.length ? (
              <div className="mt-12 border-t border-gray-200 pt-8">
                <p className="mb-4 text-center text-sm font-semibold uppercase tracking-wide text-gray-600">
                  Quick Navigation
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 transition hover:bg-[var(--color-primary-100,#dbeafe)] hover:text-[var(--color-primary-700,#1d4ed8)] sm:text-sm"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}

            {extraSection ? <div>{extraSection}</div> : null}
          </div>

          {footer ? (
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-6 sm:px-8">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function FatalStateBulletList({ theme, items }) {
  const activeTheme = THEMES[theme];

  return (
    <ul className="inline-block space-y-2 text-left text-sm text-gray-600 sm:text-base">
      {items.map((item) => (
        <li key={item} className="flex items-start">
          <span className={`mr-3 font-bold ${activeTheme.bulletAccent}`}>•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}