import { Button, CardContainer, EventCard } from "@mint-vernetzt/components";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData, useSearchParams } from "@remix-run/react";
import { utcToZonedTime } from "date-fns-tz";
import React from "react";
import { createAuthClient, getSessionUser } from "~/auth.server";
import { H1 } from "~/components/Heading/Heading";
import { getPaginationValues, prepareEvents } from "./utils.server";

import { prismaClient } from "~/prisma.server";
import { useHydrated } from "remix-utils";

export const loader = async (args: LoaderArgs) => {
  const { request } = args;
  const response = new Response();

  const { skip, take, page, itemsPerPage } = getPaginationValues(request);

  const authClient = createAuthClient(request, response);

  const sessionUser = await getSessionUser(authClient);

  const inFuture = true;
  const futureEventsCount = await prismaClient.event.count({
    where: { endTime: { gte: new Date() }, published: true },
  });

  let events: Awaited<ReturnType<typeof prepareEvents>> = [];
  if (futureEventsCount - skip > 0) {
    const actuallyTake = Math.min(take, futureEventsCount - skip);
    events = await prepareEvents(authClient, sessionUser, inFuture, {
      skip,
      take: actuallyTake,
    });
  }
  if (events.length < take && events.length > 0) {
    const pastEvents = await prepareEvents(authClient, sessionUser, !inFuture, {
      skip: 0,
      take: take - events.length,
    });
    events = [...events, ...pastEvents];
  }
  if (events.length === 0) {
    events = await prepareEvents(authClient, sessionUser, !inFuture, {
      skip: skip - futureEventsCount,
      take,
    });
  }

  return json(
    {
      events,
      pagination: {
        page,
        itemsPerPage,
      },
      userId: sessionUser?.id || undefined,
    },
    { headers: response.headers }
  );
};

function Events() {
  const loaderData = useLoaderData<typeof loader>();

  const fetcher = useFetcher<typeof loader>();
  const [searchParams] = useSearchParams();

  const [events, setEvents] = React.useState(loaderData.events);
  const [shouldFetchEvents, setShouldFetchEvents] = React.useState(() => {
    if (loaderData.events.length < loaderData.pagination.itemsPerPage) {
      return false;
    }
    return true;
  });
  const [page, setPage] = React.useState(() => {
    const pageParam = searchParams.get("page");
    if (pageParam !== null) {
      return parseInt(pageParam);
    }
    return 1;
  });

  React.useEffect(() => {
    if (fetcher.data !== undefined) {
      setEvents((events) => {
        return fetcher.data !== undefined
          ? [...events, ...fetcher.data.events]
          : [...events];
      });
      setPage(fetcher.data.pagination.page);
      if (fetcher.data.events.length < fetcher.data.pagination.itemsPerPage) {
        setShouldFetchEvents(false);
      }
    }
  }, [fetcher.data]);

  const isHydrated = useHydrated();

  return (
    <>
      <section className="container my-8 md:mt-10 lg:mt-20 text-center">
        <H1 like="h0">Entdecke Veranstaltungen</H1>
        <p className="">Finde aktuelle Veranstaltungen der MINT-Community.</p>
      </section>
      <section className="mv-mx-auto sm:mv-px-4 md:mv-px-0 xl:mv-px-2 mv-w-full sm:mv-max-w-screen-sm md:mv-max-w-screen-md lg:mv-max-w-screen-lg xl:mv-max-w-screen-xl 2xl:mv-max-w-screen-2xl">
        <CardContainer type="multi row">
          {events.length > 0 ? (
            events.map((event) => {
              const startTime = utcToZonedTime(
                event.startTime,
                "Europe/Berlin"
              );
              const endTime = utcToZonedTime(event.endTime, "Europe/Berlin");
              const participationUntil = utcToZonedTime(
                event.participationUntil,
                "Europe/Berlin"
              );

              return (
                <EventCard
                  key={event.id}
                  publicAccess={typeof loaderData.userId === "undefined"}
                  isHydrated={isHydrated}
                  event={{
                    ...event,
                    startTime,
                    endTime,
                    participationUntil,
                    responsibleOrganizations:
                      event.responsibleOrganizations.map(
                        // TODO: fix any type
                        (item: any) => item.organization
                      ),
                  }}
                />
              );
            })
          ) : (
            <p>
              Für Deine Filterkriterien konnten leider keine Profile gefunden
              werden.
            </p>
          )}
        </CardContainer>
      </section>
      {shouldFetchEvents && (
        <div className="mv-w-full mv-flex mv-justify-center">
          <fetcher.Form method="get">
            <input key="page" type="hidden" name="page" value={page + 1} />
            <Button
              size="large"
              variant="outline"
              loading={fetcher.state === "submitting"}
            >
              Weitere laden
            </Button>
          </fetcher.Form>
        </div>
      )}
    </>
  );
}

export default Events;
