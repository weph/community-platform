import type { DataFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { makeDomainFunction } from "remix-domains";
import { performMutation } from "remix-forms";
import { z } from "zod";
import { createAuthClient, getSessionUserOrThrow } from "~/auth.server";
import { checkFeatureAbilitiesOrThrow } from "~/lib/utils/application";
import { invariantResponse } from "~/lib/utils/response";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { deriveEventMode } from "~/routes/event/utils.server";
import {
  disconnectSpeakerProfileFromEvent,
  getEventBySlug,
} from "./utils.server";

const schema = z.object({
  profileId: z.string(),
});

export const removeSpeakerSchema = schema;

const mutation = makeDomainFunction(schema)(async (values) => {
  return values;
});

export const action = async (args: DataFunctionArgs) => {
  const { request, params } = args;
  const response = new Response();
  const slug = getParamValueOrThrow(params, "slug");
  const authClient = createAuthClient(request, response);
  const sessionUser = await getSessionUserOrThrow(authClient);
  const mode = await deriveEventMode(sessionUser, slug);
  invariantResponse(mode === "admin", "Not privileged", { status: 403 });
  await checkFeatureAbilitiesOrThrow(authClient, "events");

  const result = await performMutation({ request, schema, mutation });

  if (result.success === true) {
    const event = await getEventBySlug(slug);
    invariantResponse(event, "Event not found", { status: 404 });
    await disconnectSpeakerProfileFromEvent(event.id, result.data.profileId);
  }

  return json(result, { headers: response.headers });
};
