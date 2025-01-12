import type { LoaderArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { utcToZonedTime } from "date-fns-tz";
import { GravityType } from "imgproxy/dist/types";
import rcSliderStyles from "rc-slider/assets/index.css";
import React from "react";
import reactCropStyles from "react-image-crop/dist/ReactCrop.css";
import { useNavigate } from "react-router-dom";
import { forbidden, notFound, useHydrated } from "remix-utils";
import { createAuthClient, getSessionUser } from "~/auth.server";
import ImageCropper from "~/components/ImageCropper/ImageCropper";
import Modal from "~/components/Modal/Modal";
import { RichText } from "~/components/Richtext/RichText";
import { getImageURL } from "~/images.server";
import {
  canUserAccessConferenceLink,
  canUserBeAddedToWaitingList,
  canUserParticipate,
} from "~/lib/event/utils";
import { getInitials } from "~/lib/profile/getInitials";
import { getInitialsOfName } from "~/lib/string/getInitialsOfName";
import { getFeatureAbilities } from "~/lib/utils/application";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { removeHtmlTags } from "~/lib/utils/sanitizeUserHtml";
import { getDuration } from "~/lib/utils/time";
import type { ArrayElement } from "~/lib/utils/types";
import { prismaClient } from "~/prisma.server";
import {
  filterEventByVisibility,
  filterListOfEventsByVisibility,
  filterOrganizationByVisibility,
  filterProfileByVisibility,
} from "~/public-fields-filtering.server";
import { getPublicURL } from "~/storage.server";
import { deriveEventMode } from "../utils.server";
import { AddParticipantButton } from "./settings/participants/add-participant";
import { RemoveParticipantButton } from "./settings/participants/remove-participant";
import { AddToWaitingListButton } from "./settings/waiting-list/add-to-waiting-list";
import { RemoveFromWaitingListButton } from "./settings/waiting-list/remove-from-waiting-list";
import {
  enhanceChildEventsWithParticipationStatus,
  getEvent,
  getEventParticipants,
  getEventSpeakers,
  getFullDepthProfiles,
  getIsOnWaitingList,
  getIsParticipant,
  getIsSpeaker,
  getIsTeamMember,
} from "./utils.server";

export function links() {
  return [
    { rel: "stylesheet", href: rcSliderStyles },
    { rel: "stylesheet", href: reactCropStyles },
  ];
}

export const meta: MetaFunction = (args) => {
  return {
    title: `MINTvernetzt Community Plattform | ${args.data.event.name}`,
  };
};

export const loader = async (args: LoaderArgs) => {
  const { request, params } = args;
  const slug = getParamValueOrThrow(params, "slug");
  const response = new Response();
  const authClient = createAuthClient(request, response);
  const abilities = await getFeatureAbilities(authClient, "events");

  const sessionUser = await getSessionUser(authClient);

  if (sessionUser !== null) {
    const userProfile = await prismaClient.profile.findFirst({
      where: { id: sessionUser.id },
      select: { termsAccepted: true },
    });
    if (userProfile !== null) {
      if (userProfile.termsAccepted === false) {
        return redirect(`/accept-terms?redirect_to=/event/${slug}`, {
          headers: response.headers,
        });
      }
    } else {
      throw notFound({ message: `Profile not found` });
    }
  }

  const rawEvent = await getEvent(slug);

  if (rawEvent === null) {
    throw notFound({ message: `Event not found` });
  }

  const mode = await deriveEventMode(sessionUser, slug);

  // TODO: Could this be inserted in deriveEventMode? It defines a mode for the session user in this specific context.
  let isParticipant;
  let isOnWaitingList;
  let isSpeaker;
  let isTeamMember;
  if (sessionUser !== null) {
    isParticipant = await getIsParticipant(rawEvent.id, sessionUser.id);
    isOnWaitingList = await getIsOnWaitingList(rawEvent.id, sessionUser.id);
    isSpeaker = await getIsSpeaker(rawEvent.id, sessionUser.id);
    isTeamMember = await getIsTeamMember(rawEvent.id, sessionUser.id);
  } else {
    isParticipant = false;
    isOnWaitingList = false;
    isSpeaker = false;
    isTeamMember = false;
  }

  if (mode !== "admin" && !isTeamMember && rawEvent.published === false) {
    throw forbidden({ message: "Event not published" });
  }

  let speakers: Awaited<
    ReturnType<typeof getEventSpeakers | typeof getFullDepthProfiles>
  > = [];
  let participants: Awaited<
    ReturnType<typeof getEventParticipants | typeof getFullDepthProfiles>
  > = [];

  // Adding participants and speakers
  if (rawEvent.childEvents.length > 0) {
    speakers = (await getFullDepthProfiles(rawEvent.id, "speakers")) || [];
    participants =
      (await getFullDepthProfiles(rawEvent.id, "participants")) || [];
  } else {
    speakers = await getEventSpeakers(rawEvent.id);
    participants = await getEventParticipants(rawEvent.id);
  }
  let enhancedEvent = {
    ...rawEvent,
    speakers,
    participants,
  };

  // Filtering by publish status
  const filteredChildEvents = [];
  for (let childEvent of enhancedEvent.childEvents) {
    if (childEvent.published) {
      filteredChildEvents.push(childEvent);
    } else {
      if (sessionUser !== null) {
        const childMode = await deriveEventMode(sessionUser, childEvent.slug);
        const isTeamMember = await getIsTeamMember(
          childEvent.id,
          sessionUser.id
        );
        if (childMode === "admin" || isTeamMember) {
          filteredChildEvents.push(childEvent);
        }
      }
    }
  }
  enhancedEvent = { ...enhancedEvent, childEvents: filteredChildEvents };

  // Filtering by visbility settings
  if (sessionUser === null) {
    // Filter event
    enhancedEvent = await filterEventByVisibility<typeof enhancedEvent>(
      enhancedEvent
    );
    // Filter parent event
    if (enhancedEvent.parentEvent !== null) {
      enhancedEvent.parentEvent = await filterEventByVisibility<
        typeof enhancedEvent.parentEvent
      >(enhancedEvent.parentEvent);
    }
    // Filter participants
    enhancedEvent.participants = await Promise.all(
      enhancedEvent.participants.map(async (relation) => {
        const filteredProfile = await filterProfileByVisibility<
          typeof relation.profile
        >(relation.profile);
        return { ...relation, profile: filteredProfile };
      })
    );
    // Filter speakers
    enhancedEvent.speakers = await Promise.all(
      enhancedEvent.speakers.map(async (relation) => {
        const filteredProfile = await filterProfileByVisibility<
          typeof relation.profile
        >(relation.profile);
        return { ...relation, profile: filteredProfile };
      })
    );
    // Filter team members
    enhancedEvent.teamMembers = await Promise.all(
      enhancedEvent.teamMembers.map(async (relation) => {
        const filteredProfile = await filterProfileByVisibility<
          typeof relation.profile
        >(relation.profile);
        return { ...relation, profile: filteredProfile };
      })
    );
    // Filter child events
    enhancedEvent.childEvents = await filterListOfEventsByVisibility<
      ArrayElement<typeof enhancedEvent.childEvents>
    >(enhancedEvent.childEvents);
    // Filter responsible Organizations
    enhancedEvent.responsibleOrganizations = await Promise.all(
      enhancedEvent.responsibleOrganizations.map(async (relation) => {
        const filteredOrganization = await filterOrganizationByVisibility<
          typeof relation.organization
        >(relation.organization);
        return { ...relation, organization: filteredOrganization };
      })
    );
  }

  // Add images from image proxy
  if (enhancedEvent.speakers !== null) {
    enhancedEvent.speakers = enhancedEvent.speakers.map((relation) => {
      let avatar = relation.profile.avatar;
      if (avatar !== null) {
        const publicURL = getPublicURL(authClient, avatar);
        if (publicURL !== null) {
          avatar = getImageURL(publicURL, {
            resize: { type: "fill", width: 64, height: 64 },
            gravity: GravityType.center,
          });
        }
      }
      return { ...relation, profile: { ...relation.profile, avatar } };
    });
  }

  enhancedEvent.teamMembers = enhancedEvent.teamMembers.map((relation) => {
    let avatar = relation.profile.avatar;
    if (avatar !== null) {
      const publicURL = getPublicURL(authClient, avatar);
      if (publicURL !== null) {
        avatar = getImageURL(publicURL, {
          resize: { type: "fill", width: 64, height: 64 },
          gravity: GravityType.center,
        });
      }
    }
    return { ...relation, profile: { ...relation.profile, avatar } };
  });

  if (enhancedEvent.participants !== null) {
    enhancedEvent.participants = enhancedEvent.participants.map((relation) => {
      let avatar = relation.profile.avatar;
      if (avatar !== null) {
        const publicURL = getPublicURL(authClient, avatar);
        if (publicURL !== null) {
          avatar = getImageURL(publicURL, {
            resize: { type: "fill", width: 64, height: 64 },
            gravity: GravityType.center,
          });
        }
      }
      return { ...relation, profile: { ...relation.profile, avatar } };
    });
  }

  let blurredBackground;
  if (enhancedEvent.background !== null) {
    const publicURL = getPublicURL(authClient, enhancedEvent.background);
    if (publicURL) {
      enhancedEvent.background = getImageURL(publicURL, {
        resize: { type: "fill", width: 720, height: 480, enlarge: true },
      });
      blurredBackground = getImageURL(publicURL, {
        resize: { type: "fill", width: 72, height: 48 },
        blur: 5,
      });
    }
  }

  const imageEnhancedChildEvents = enhancedEvent.childEvents.map((relation) => {
    let background = relation.background;
    let blurredChildBackground;
    if (background !== null) {
      const publicURL = getPublicURL(authClient, background);
      if (publicURL) {
        background = getImageURL(publicURL, {
          resize: { type: "fill", width: 144, height: 96 },
        });
      }
      blurredChildBackground = getImageURL(publicURL, {
        resize: { type: "fill", width: 18, height: 12 },
        blur: 5,
      });
    }
    return { ...relation, background, blurredChildBackground };
  });

  enhancedEvent.responsibleOrganizations =
    enhancedEvent.responsibleOrganizations.map((relation) => {
      let logo = relation.organization.logo;
      if (logo !== null) {
        const publicURL = getPublicURL(authClient, logo);
        if (publicURL) {
          logo = getImageURL(publicURL, {
            resize: { type: "fit", width: 144, height: 144 },
          });
        }
      }
      return { ...relation, organization: { ...relation.organization, logo } };
    });

  const imageEnhancedEvent = {
    ...enhancedEvent,
    blurredBackground,
    childEvents: imageEnhancedChildEvents,
  };

  // Adding participation status
  const enhancedChildEvents = await enhanceChildEventsWithParticipationStatus(
    sessionUser,
    imageEnhancedEvent.childEvents
  );

  const eventWithParticipationStatus = {
    ...imageEnhancedEvent,
    childEvents: enhancedChildEvents,
  };

  // Hiding conference link when session user is not participating (participant, speaker, teamMember) or when its not known yet
  if (
    !canUserAccessConferenceLink(
      eventWithParticipationStatus,
      isParticipant,
      isSpeaker,
      isTeamMember
    )
  ) {
    eventWithParticipationStatus.conferenceLink = null;
    eventWithParticipationStatus.conferenceCode = null;
  } else {
    // TODO: move decision what to show in link (message) to frontend (allow handling in frontend, do not decide on backend)
    if (
      eventWithParticipationStatus.conferenceLink === null ||
      eventWithParticipationStatus.conferenceLink === ""
    ) {
      eventWithParticipationStatus.conferenceLink = "noch nicht bekannt";
      eventWithParticipationStatus.conferenceCode = null;
    }
  }

  return json(
    {
      mode,
      event: eventWithParticipationStatus,
      userId: sessionUser?.id || undefined,
      isParticipant,
      isOnWaitingList,
      isSpeaker,
      isTeamMember,
      abilities,
    },
    { headers: response.headers }
  );
};

function getForm(loaderData: {
  userId?: string;
  isParticipant: boolean;
  isOnWaitingList: boolean;
  event: {
    id: string;
    participantLimit: number | null;
    _count: {
      participants: number;
    };
  };
}) {
  const isParticipating = loaderData.isParticipant;
  const isOnWaitingList = loaderData.isOnWaitingList;

  const participantLimitReached =
    loaderData.event.participantLimit !== null
      ? loaderData.event.participantLimit <=
        loaderData.event._count.participants
      : false;

  if (isParticipating) {
    return (
      <RemoveParticipantButton
        action="./settings/participants/remove-participant"
        profileId={loaderData.userId}
      />
    );
  } else if (isOnWaitingList) {
    return (
      <RemoveFromWaitingListButton
        action="./settings/waiting-list/remove-from-waiting-list"
        profileId={loaderData.userId}
      />
    );
  } else {
    if (participantLimitReached) {
      return (
        <AddToWaitingListButton
          action="./settings/waiting-list/add-to-waiting-list"
          profileId={loaderData.userId}
        />
      );
    } else {
      return (
        <AddParticipantButton
          action="./settings/participants/add-participant"
          profileId={loaderData.userId}
        />
      );
    }
  }
}

function formatDateTime(date: Date) {
  const formattedDate = `${date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })}, ${date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  })} Uhr`;
  return formattedDate;
}

function Index() {
  const loaderData = useLoaderData<typeof loader>();

  const navigate = useNavigate();

  const [historyStateIndex, setHistoryStateIndex] = React.useState(0);

  React.useEffect(() => {
    if (window !== undefined && window.history !== undefined) {
      setHistoryStateIndex(window.history.state.idx);
    }
  }, [loaderData.event.id]);

  const now = utcToZonedTime(new Date(), "Europe/Berlin");

  const startTime = utcToZonedTime(loaderData.event.startTime, "Europe/Berlin");
  const endTime = utcToZonedTime(loaderData.event.endTime, "Europe/Berlin");
  const participationFrom = utcToZonedTime(
    loaderData.event.participationFrom,
    "Europe/Berlin"
  );
  const participationUntil = utcToZonedTime(
    loaderData.event.participationUntil,
    "Europe/Berlin"
  );

  const beforeParticipationPeriod = now < participationFrom;

  const afterParticipationPeriod = now > participationUntil;

  const laysInThePast = now > endTime;

  const Form = getForm(loaderData);

  const duration = getDuration(startTime, endTime);

  const background = loaderData.event.background;
  const Background = React.useCallback(
    () => (
      <div className="w-full rounded-md overflow-hidden aspect-[3/2]">
        {background ? (
          <img
            src={background}
            alt={`Aktuelles Hintergrundbild`}
            className="w-full h-full"
          />
        ) : (
          <img
            src={"/images/default-event-background.jpg"}
            alt={`Aktuelles Hintergrundbild`}
            className="w-full h-full"
          />
        )}
      </div>
    ),
    [background]
  );

  const isHydrated = useHydrated();

  return (
    <>
      <section className="container md:mt-2">
        <div className="font-semi text-neutral-500 flex flex-wrap items-center mb-4">
          {loaderData.event.parentEvent !== null ? (
            <>
              <Link
                className=""
                to={`/event/${loaderData.event.parentEvent.slug}`}
                reloadDocument
              >
                {loaderData.event.parentEvent.name}
              </Link>
              <span className="mx-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  fill="currentColor"
                  viewBox="0 0 16 16"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                  />
                </svg>
              </span>
            </>
          ) : null}
          <span className="w-full md:w-auto">{loaderData.event.name}</span>
        </div>
        <div className="font-semi text-neutral-600 flex items-center">
          {/* TODO: get back route from loader */}
          {historyStateIndex > 0 ? (
            <button onClick={() => navigate(-1)} className="flex items-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                className="h-auto w-6"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <path
                  fillRule="evenodd"
                  d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8z"
                />
              </svg>
              <span className="ml-2">Zurück</span>
            </button>
          ) : (
            <div className="w-6 h-6"></div>
          )}
        </div>
      </section>
      <section className="container mt-6">
        <div className="md:rounded-3xl overflow-hidden w-full relative">
          <div className="hidden md:block">
            <div className="relative overflow-hidden w-full aspect-[31/10]">
              <div className="w-full h-full relative">
                <img
                  src={
                    loaderData.event.blurredBackground ||
                    "/images/default-event-background-blurred.jpg"
                  }
                  alt="Rahmen des Hintergrundbildes"
                  className="w-full h-full object-cover"
                />
                <img
                  id="background"
                  src={
                    loaderData.event.background ||
                    "/images/default-event-background.jpg"
                  }
                  alt={loaderData.event.name}
                  className={`w-full h-full object-contain absolute inset-0 ${
                    isHydrated
                      ? "opacity-100 transition-opacity duration-200 ease-in"
                      : "opacity-0 invisible"
                  }`}
                />
                <noscript>
                  <img
                    src={
                      loaderData.event.background ||
                      "/images/default-event-background.jpg"
                    }
                    alt={loaderData.event.name}
                    className={`w-full h-full object-contain absolute inset-0`}
                  />
                </noscript>
              </div>
              {loaderData.mode === "admin" &&
              loaderData.abilities.events.hasAccess ? (
                <div className="absolute bottom-6 right-6">
                  <label
                    htmlFor="modal-background-upload"
                    className="btn btn-primary modal-button"
                  >
                    Bild ändern
                  </label>

                  <Modal id="modal-background-upload">
                    <ImageCropper
                      headline="Hintergrundbild"
                      subject="event"
                      id="modal-background-upload"
                      uploadKey="background"
                      image={loaderData.event.background || undefined}
                      aspect={3 / 2}
                      minCropWidth={72}
                      minCropHeight={48}
                      maxTargetWidth={720}
                      maxTargetHeight={480}
                      slug={loaderData.event.slug}
                      redirect={`/event/${loaderData.event.slug}`}
                    >
                      <Background />
                    </ImageCropper>
                  </Modal>
                </div>
              ) : null}
            </div>
          </div>
          {loaderData.mode === "admin" || loaderData.isTeamMember ? (
            <>
              {loaderData.event.canceled ? (
                <div className="md:absolute md:top-0 md:inset-x-0 font-semibold text-center bg-salmon-500 p-2 text-white">
                  Abgesagt
                </div>
              ) : (
                <>
                  {loaderData.event.published ? (
                    <div className="md:absolute md:top-0 md:inset-x-0 font-semibold text-center bg-green-600 p-2 text-white">
                      Veröffentlicht
                    </div>
                  ) : (
                    <div className="md:absolute md:top-0 md:inset-x-0 font-semibold text-center bg-blue-300 p-2 text-white">
                      Entwurf
                    </div>
                  )}
                </>
              )}
            </>
          ) : null}

          {loaderData.mode !== "admin" && loaderData.event.canceled ? (
            <div className="md:absolute md:top-0 md:inset-x-0 font-semibold text-center bg-salmon-500 p-2 text-white">
              Abgesagt
            </div>
          ) : null}
          {loaderData.mode !== "admin" ? (
            <>
              {beforeParticipationPeriod || afterParticipationPeriod ? (
                <div className="bg-accent-300 p-8">
                  <p className="font-bold text-center">
                    {laysInThePast
                      ? "Veranstaltung hat bereits stattgefunden."
                      : beforeParticipationPeriod
                      ? "Anmeldefrist hat noch nicht begonnen."
                      : "Anmeldefrist ist bereits abgelaufen."}
                  </p>
                </div>
              ) : (
                <>
                  {loaderData.event.parentEvent !== null &&
                  laysInThePast === false ? (
                    <div className="md:bg-white md:border md:border-neutral-500 md:rounded-b-3xl md:py-6">
                      <div className="md:flex -mx-[17px] items-center">
                        <div className="w-full hidden lg:flex lg:flex-1/4 px-4"></div>
                        <div className="w-full md:flex-auto px-4">
                          <p className="font-bold xl:text-center md:pl-4 lg:pl-0 pb-4 md:pb-0">
                            Diese Veranstaltung findet im Rahmen von "
                            <Link
                              className="underline hover:no-underline"
                              to={`/event/${loaderData.event.parentEvent.slug}`}
                              reloadDocument
                            >
                              {loaderData.event.parentEvent.name}
                            </Link>
                            " statt.
                          </p>
                        </div>
                        <div className="w-full lg:flex-1/4 px-4 text-right">
                          <div className="pr-4 lg:pr-8">
                            <>
                              {loaderData.mode === "anon" &&
                              loaderData.event.canceled === false ? (
                                <Link
                                  className="btn btn-primary"
                                  to={`/login?login_redirect=/event/${loaderData.event.slug}`}
                                >
                                  Anmelden um teilzunehmen
                                </Link>
                              ) : null}
                              {loaderData.mode !== "anon" &&
                              loaderData.event.canceled === false ? (
                                <>{Form}</>
                              ) : null}
                            </>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : loaderData.event.childEvents.length > 0 &&
                    laysInThePast === false ? (
                    <div className="md:bg-accent-300 md:rounded-b-3xl md:py-6">
                      <div className="md:flex -mx-[17px] items-center">
                        <div className="w-full hidden lg:flex lg:flex-1/4 px-4"></div>
                        <div className="w-full md:flex-auto px-4">
                          <p className="font-bold xl:text-center md:pl-4 lg:pl-0 pb-4 md:pb-0">
                            Wähle{" "}
                            <a
                              href="#child-events"
                              className="underline hover:no-underline"
                            >
                              zugehörige Veranstaltungen
                            </a>{" "}
                            aus, an denen Du teilnehmen möchtest.
                          </p>
                        </div>
                        <div className="w-full lg:flex-1/4 px-4 text-right">
                          <div className="pr-4 lg:pr-8">
                            <>
                              {loaderData.mode === "anon" &&
                              loaderData.event.canceled === false ? (
                                <Link
                                  className="btn btn-primary"
                                  to={`/login?login_redirect=/event/${loaderData.event.slug}`}
                                >
                                  Anmelden um teilzunehmen
                                </Link>
                              ) : null}
                              {loaderData.mode !== "anon" &&
                              loaderData.event.canceled === false ? (
                                <>{Form}</>
                              ) : null}
                            </>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : laysInThePast === false ? (
                    <div className="md:bg-white md:border md:border-neutral-500 md:rounded-b-3xl md:py-6 md:text-right pr-4 lg:pr-8">
                      <>
                        {loaderData.mode === "anon" &&
                        loaderData.event.canceled === false ? (
                          <Link
                            className="btn btn-primary"
                            to={`/login?login_redirect=/event/${loaderData.event.slug}`}
                          >
                            Anmelden um teilzunehmen
                          </Link>
                        ) : null}
                        {loaderData.mode !== "anon" &&
                        loaderData.event.canceled === false ? (
                          <>{Form}</>
                        ) : null}
                      </>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>
        {loaderData.mode === "admin" &&
        loaderData.abilities.events.hasAccess ? (
          <>
            <div className="bg-accent-white p-8 pb-0">
              <p className="font-bold text-right">
                <Link
                  className="btn btn-outline btn-primary ml-4 mb-2 md:mb-0"
                  to={`/event/${loaderData.event.slug}/settings`}
                >
                  Veranstaltung bearbeiten
                </Link>
                <Link
                  className="btn btn-primary ml-4"
                  to={`/event/create/?parent=${loaderData.event.id}`}
                >
                  Zugehörige Veranstaltungen anlegen
                </Link>
              </p>
            </div>
          </>
        ) : null}
      </section>
      <div className="container relative pt-8 lg:pt-16 pb-20 lg:pb-44">
        <div className="flex -mx-4 justify-center">
          <div className="lg:flex-1/2 px-4">
            <p className="font-bold text-xl mb-8">{duration}</p>
            <header className="mb-8">
              <h1 className="m-0">{loaderData.event.name}</h1>
              {loaderData.event.subline !== null ? (
                <p className="font-bold text-xl mt-2">
                  {loaderData.event.subline}
                </p>
              ) : null}
            </header>
            {loaderData.event.description !== null ? (
              <RichText
                html={loaderData.event.description}
                additionalClassNames="mb-6"
              />
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-[minmax(100px,_1fr)_4fr] gap-x-4 gap-y-1 md:gap-y-6">
              {loaderData.event.types.length > 0 ? (
                <>
                  <div className="text-xs leading-6">Veranstaltungsart</div>
                  <div className="pb-3 md:pb-0">
                    {loaderData.event.types
                      .map((item) => item.eventType.title)
                      .join(" / ")}
                  </div>
                </>
              ) : null}

              {loaderData.event.venueName !== null ? (
                <>
                  <div className="text-xs leading-6">Veranstaltungsort</div>
                  <div className="pb-3 md:pb-0">
                    <p>
                      {loaderData.event.venueName},{" "}
                      {loaderData.event.venueStreet}{" "}
                      {loaderData.event.venueStreetNumber},{" "}
                      {loaderData.event.venueZipCode}{" "}
                      {loaderData.event.venueCity}
                    </p>
                  </div>
                </>
              ) : null}

              {loaderData.event.conferenceLink !== null &&
              loaderData.event.conferenceLink !== "" ? (
                <>
                  <div className="text-xs leading-6">Konferenzlink</div>
                  <div className="pb-3 md:pb-0">
                    <a
                      href={loaderData.event.conferenceLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {loaderData.event.conferenceLink}
                    </a>
                  </div>
                </>
              ) : null}
              {loaderData.event.conferenceCode !== null &&
              loaderData.event.conferenceCode !== "" ? (
                <>
                  <div className="text-xs leading-6">Konferenz-Code</div>
                  <div className="pb-3 md:pb-0">
                    {loaderData.event.conferenceCode}
                  </div>
                </>
              ) : null}

              <div className="text-xs leading-6">Start</div>
              <div className="pb-3 md:pb-0">{formatDateTime(startTime)}</div>

              <div className="text-xs leading-6">Ende</div>
              <div className="pb-3 md:pb-0">{formatDateTime(endTime)}</div>

              {participationFrom > now ? (
                <>
                  <div className="text-xs leading-6">Registrierungsbeginn</div>
                  <div className="pb-3 md:pb-0">
                    {formatDateTime(participationFrom)}
                  </div>
                </>
              ) : null}
              {participationUntil > now ? (
                <>
                  <div className="text-xs leading-6">Registrierungsende</div>
                  <div className="pb-3 md:pb-0">
                    {formatDateTime(participationUntil)}
                  </div>
                </>
              ) : null}

              <div className="text-xs leading-6">Verfügbare Plätze</div>
              <div className="pb-3 md:pb-0">
                {loaderData.event.participantLimit === null ? (
                  "ohne Beschränkung"
                ) : (
                  <>
                    {loaderData.event.participantLimit -
                      loaderData.event._count.participants <
                    0
                      ? 0
                      : loaderData.event.participantLimit -
                        loaderData.event._count.participants}{" "}
                    / {loaderData.event.participantLimit}
                  </>
                )}
              </div>

              {loaderData.isParticipant === true ||
              loaderData.isSpeaker === true ||
              loaderData.isTeamMember === true ? (
                <>
                  <div className="text-xs leading-6 mt-1">Kalender-Eintrag</div>
                  <div className="pb-3 md:pb-0">
                    <Link
                      className="btn btn-outline btn-primary btn-small"
                      to="ics-download"
                      reloadDocument
                    >
                      Download
                    </Link>
                  </div>
                </>
              ) : null}

              {loaderData.mode !== "anon" &&
              loaderData.event.documents.length > 0 ? (
                <>
                  <div className="text-xs leading-6">Downloads</div>
                  <div className="pb-3 md:pb-0">
                    {loaderData.event.documents.map((item) => {
                      return (
                        <div key={`document-${item.document.id}`} className="">
                          <Link
                            className="underline hover:no-underline"
                            to={`/event/${loaderData.event.slug}/documents-download?document_id=${item.document.id}`}
                            reloadDocument
                          >
                            {item.document.title || item.document.filename}
                          </Link>
                          {item.document.description ? (
                            <p className="text-sm italic">
                              {item.document.description}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                    {loaderData.event.documents.length > 1 ? (
                      <Link
                        className="btn btn-outline btn-primary btn-small mt-4"
                        to={`/event/${loaderData.event.slug}/documents-download`}
                        reloadDocument
                      >
                        Alle Herunterladen
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : null}

              {loaderData.event.focuses.length > 0 ? (
                <>
                  <div className="text-xs leading-5 pt-[7px]">Schwerpunkte</div>
                  <div className="event-tags -m-1 pb-3 md:pb-0">
                    {loaderData.event.focuses.map((item, index) => {
                      return (
                        <div key={`focus-${index}`} className="badge">
                          {item.focus.title}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {loaderData.event.targetGroups.length > 0 ? (
                <>
                  <div className="text-xs leading-5 pt-[7px]">Zielgruppe</div>
                  <div className="event-tags -m-1 pb-3 md:pb-0">
                    {loaderData.event.targetGroups.map((item, index) => {
                      return (
                        <div key={`targetGroups-${index}`} className="badge">
                          {item.targetGroup.title}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {loaderData.event.experienceLevel ? (
                <>
                  <div className="text-xs leading-5 pt-[7px]">
                    Erfahrunsglevel
                  </div>
                  <div className="event-tags -m-1 pb-3 md:pb-0">
                    <div className="badge">
                      {loaderData.event.experienceLevel.title}
                    </div>
                  </div>
                </>
              ) : null}

              {loaderData.event.tags.length > 0 ? (
                <>
                  <div className="text-xs leading-5 pt-[7px]">Tags</div>
                  <div className="event-tags -m-1 pb-3 md:pb-0">
                    {loaderData.event.tags.map((item, index) => {
                      return (
                        <div key={`tags-${index}`} className="badge">
                          {item.tag.title}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {loaderData.event.areas.length > 0 ? (
                <>
                  <div className="text-xs leading-5 pt-[7px]">Gebiete</div>
                  <div className="event-tags -m-1 pb-3 md:pb-0">
                    {loaderData.event.areas.map((item, index) => {
                      return (
                        <div key={`areas-${index}`} className="badge">
                          {item.area.name}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>

            {loaderData.event.speakers !== null &&
            loaderData.event.speakers.length > 0 ? (
              <>
                <h3 className="mt-16 mb-8 font-bold">Speaker:innen</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-16">
                  {loaderData.event.speakers.map((speaker) => {
                    const { profile } = speaker;
                    return (
                      <div key={profile.username}>
                        <Link
                          className="flex flex-row"
                          to={`/profile/${profile.username}`}
                        >
                          <div className="h-11 w-11 bg-primary text-white text-xl flex items-center justify-center rounded-full overflow-hidden shrink-0 border">
                            {profile.avatar !== null &&
                            profile.avatar !== "" ? (
                              <img
                                src={profile.avatar}
                                alt={`${profile.academicTitle || ""} ${
                                  profile.firstName
                                } ${profile.lastName}`.trimStart()}
                              />
                            ) : (
                              getInitials(profile)
                            )}
                          </div>

                          <div className="pl-4">
                            <h5 className="text-sm m-0 font-bold">
                              {`${profile.academicTitle || ""} ${
                                profile.firstName
                              } ${profile.lastName}`.trimStart()}
                            </h5>
                            <p className="text-sm m-0 line-clamp-2">
                              {profile.position}
                            </p>
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            {loaderData.event.childEvents.length > 0 ? (
              <>
                <h3 id="child-events" className="mt-16 font-bold">
                  Zugehörige Veranstaltungen
                </h3>
                <p className="mb-8">
                  Diese Veranstaltungen finden im Rahmen von "
                  {loaderData.event.name}" statt.
                </p>
                <div className="mb-16">
                  {loaderData.event.childEvents.map((event) => {
                    const eventStartTime = utcToZonedTime(
                      event.startTime,
                      "Europe/Berlin"
                    );
                    const eventEndTime = utcToZonedTime(
                      event.endTime,
                      "Europe/Berlin"
                    );
                    return (
                      <div
                        key={`child-event-${event.id}`}
                        className="rounded-lg bg-white shadow-xl border-t border-r border-neutral-300  mb-2 flex items-stretch overflow-hidden"
                      >
                        <Link
                          className="flex"
                          to={`/event/${event.slug}`}
                          reloadDocument
                        >
                          <div className="hidden xl:block w-36 shrink-0 aspect-[3/2]">
                            <div className="w-36 h-full relative">
                              <img
                                src={
                                  event.blurredChildBackground ||
                                  "/images/default-event-background-blurred.jpg"
                                }
                                alt="Rahmen des Hintergrundbildes"
                                className="w-full h-full object-cover"
                              />
                              <img
                                src={
                                  event.background ||
                                  "/images/default-event-background.jpg"
                                }
                                alt={event.name}
                                className={`w-full h-full object-cover absolute inset-0 ${
                                  isHydrated
                                    ? "opacity-100 transition-opacity duration-200 ease-in"
                                    : "opacity-0 invisible"
                                }`}
                              />
                              <noscript>
                                <img
                                  src={
                                    event.background ||
                                    "/images/default-event-background.jpg"
                                  }
                                  alt={event.name}
                                  className={`w-full h-full object-cover absolute inset-0`}
                                />
                              </noscript>
                            </div>
                          </div>
                          <div className="px-4 py-4">
                            <p className="text-xs mb-1">
                              {/* TODO: Display icons (see figma) */}
                              {event.stage !== null
                                ? event.stage.title + " | "
                                : ""}
                              {getDuration(eventStartTime, eventEndTime)}
                              {event.participantLimit === null
                                ? " | Unbegrenzte Plätze"
                                : ` | ${
                                    event.participantLimit -
                                    event._count.participants
                                  } / ${event.participantLimit} Plätzen frei`}
                              {event.participantLimit !== null &&
                              event._count.participants >=
                                event.participantLimit ? (
                                <>
                                  {" "}
                                  |{" "}
                                  <span>
                                    {event._count.waitingList} auf der
                                    Warteliste
                                  </span>
                                </>
                              ) : (
                                ""
                              )}
                            </p>
                            <h4 className="font-bold text-base m-0 md:line-clamp-1">
                              {event.name}
                            </h4>
                            {event.subline !== null ? (
                              <p className="hidden md:block text-xs mt-1 md:line-clamp-1">
                                {event.subline}
                              </p>
                            ) : (
                              <p className="hidden md:block text-xs mt-1 md:line-clamp-1">
                                {removeHtmlTags(event.description ?? "")}
                              </p>
                            )}
                          </div>
                        </Link>

                        {(loaderData.mode === "admin" ||
                          loaderData.isTeamMember) &&
                        !event.canceled ? (
                          <>
                            {event.published ? (
                              <div className="flex font-semibold items-center ml-auto border-r-8 border-green-600 pr-4 py-6 text-green-600">
                                Veröffentlicht
                              </div>
                            ) : (
                              <div className="flex font-semibold items-center ml-auto border-r-8 border-blue-300 pr-4 py-6 text-blue-300">
                                Entwurf
                              </div>
                            )}
                          </>
                        ) : null}
                        {event.canceled ? (
                          <div className="flex font-semibold items-center ml-auto border-r-8 border-salmon-500 pr-4 py-6 text-salmon-500">
                            Abgesagt
                          </div>
                        ) : null}
                        {event.isParticipant &&
                        !event.canceled &&
                        loaderData.mode !== "admin" ? (
                          <div className="flex font-semibold items-center ml-auto border-r-8 border-green-500 pr-4 py-6 text-green-600">
                            <p>Angemeldet</p>
                          </div>
                        ) : null}
                        {canUserParticipate(event) &&
                        loaderData.userId !== undefined ? (
                          <div className="flex items-center ml-auto pr-4 py-6">
                            <AddParticipantButton
                              action={`/event/${event.slug}/settings/participants/add-participant`}
                              profileId={loaderData.userId}
                            />
                          </div>
                        ) : null}
                        {event.isOnWaitingList &&
                        !event.canceled &&
                        loaderData.mode !== "admin" ? (
                          <div className="flex font-semibold items-center ml-auto border-r-8 border-neutral-500 pr-4 py-6">
                            <p>Wartend</p>
                          </div>
                        ) : null}
                        {canUserBeAddedToWaitingList(event) &&
                        loaderData.userId !== undefined ? (
                          <div className="flex items-center ml-auto pr-4 py-6">
                            <AddToWaitingListButton
                              action={`/event/${event.slug}/settings/waiting-list/add-to-waiting-list`}
                              profileId={loaderData.userId}
                            />
                          </div>
                        ) : null}
                        {event.published &&
                        !event.isParticipant &&
                        loaderData.mode !== "admin" &&
                        !canUserParticipate(event) &&
                        !event.isOnWaitingList &&
                        !canUserBeAddedToWaitingList(event) &&
                        !event.canceled &&
                        loaderData.mode === "authenticated" ? (
                          <div className="flex items-center ml-auto pr-4 py-6">
                            <Link
                              to={`/event/${event.slug}`}
                              className="btn btn-primary"
                            >
                              Mehr erfahren
                            </Link>
                          </div>
                        ) : null}
                        {loaderData.mode === "anon" &&
                        event.canceled === false ? (
                          <div className="flex items-center ml-auto pr-4 py-6">
                            <Link
                              className="btn btn-primary"
                              to={`/login?login_redirect=/event/${event.slug}`}
                            >
                              Anmelden
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {loaderData.event.teamMembers.length > 0 ? (
              <>
                <h3 className="mt-16 mb-8 font-bold">Team</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {loaderData.event.teamMembers.map((member) => {
                    return (
                      <div key={`team-member-${member.profile.id}`}>
                        <Link
                          className="flex flex-row"
                          to={`/profile/${member.profile.username}`}
                        >
                          <div className="h-11 w-11 bg-primary text-white text-xl flex items-center justify-center rounded-full overflow-hidden shrink-0 border">
                            {member.profile.avatar !== null &&
                            member.profile.avatar !== "" ? (
                              <img
                                src={member.profile.avatar}
                                alt={`${member.profile.academicTitle || ""} ${
                                  member.profile.firstName
                                } ${member.profile.lastName}`.trimStart()}
                              />
                            ) : (
                              getInitials(member.profile)
                            )}
                          </div>

                          <div className="pl-4">
                            <h5 className="text-sm m-0 font-bold">
                              {`${member.profile.academicTitle || ""} ${
                                member.profile.firstName
                              } ${member.profile.lastName}`.trimStart()}
                            </h5>
                            <p className="text-sm m-0 line-clamp-2">
                              {member.profile.position}
                            </p>
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
            {loaderData.event.responsibleOrganizations.length > 0 ? (
              <>
                <h3
                  id="responsible-organizations"
                  className="mt-16 mb-8 font-bold"
                >
                  Veranstaltet von
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {loaderData.event.responsibleOrganizations.map((item) => {
                    return (
                      <div key={`organizer-${item.organization.id}`}>
                        <Link
                          className="flex flex-row"
                          to={`/organization/${item.organization.slug}`}
                        >
                          {item.organization.logo !== null &&
                          item.organization.logo !== "" ? (
                            <div className="h-11 w-11 flex items-center justify-center rounded-full overflow-hidden shrink-0 border">
                              <img
                                src={item.organization.logo}
                                alt={item.organization.name}
                              />
                            </div>
                          ) : (
                            <div className="h-11 w-11 bg-primary text-white text-xl flex items-center justify-center rounded-full overflow-hidden shrink-0">
                              {getInitialsOfName(item.organization.name)}
                            </div>
                          )}
                          <div className="pl-4">
                            <h5 className="text-sm m-0 font-bold">
                              {item.organization.name}
                            </h5>

                            <p className="text-sm m-0 line-clamp-2">
                              {item.organization.types
                                .map((item) => item.organizationType.title)
                                .join(", ")}
                            </p>
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}

            {loaderData.event.participants !== null &&
            loaderData.event.participants.length > 0 ? (
              <>
                <h3 className="mt-16 mb-8 font-bold">Teilnehmer:innen</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {loaderData.event.participants.map((participant) => {
                    const { profile } = participant;
                    return (
                      <div key={profile.username}>
                        <Link
                          className="flex flex-row"
                          to={`/profile/${profile.username}`}
                        >
                          <div className="h-11 w-11 bg-primary text-white text-xl flex items-center justify-center rounded-full overflow-hidden shrink-0 border">
                            {profile.avatar !== null &&
                            profile.avatar !== "" ? (
                              <img
                                src={profile.avatar}
                                alt={`${profile.academicTitle || ""} ${
                                  profile.firstName
                                } ${profile.lastName}`.trimStart()}
                              />
                            ) : (
                              getInitials(profile)
                            )}
                          </div>

                          <div className="pl-4">
                            <h5 className="text-sm m-0 font-bold">
                              {`${profile.academicTitle || ""} ${
                                profile.firstName
                              } ${profile.lastName}`.trimStart()}
                            </h5>
                            <p className="text-sm m-0 line-clamp-2">
                              {profile.position}
                            </p>
                          </div>
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

export default Index;
