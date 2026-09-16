import { createClient } from '@supabase/supabase-js'

/**
 * De opslagbak met bijlagen. Twee bewerkingen, meer heeft de backend niet nodig:
 * een tijdelijke uploadlink uitgeven (de browser uploadt daar rechtstreeks naartoe) en een bestand
 * weer ophalen om het bij de Asana-taak te zetten.
 *
 * Bewust géén `info()` vooraf: de bucket weigert zelf alles boven de bestandsgrens, dus wat we
 * ophalen is per definitie klein genoeg om in één keer te lezen. Grootte en type controleren we aan
 * de binnengekomen bytes, dat is toch de enige waarde die niet te vervalsen is.
 */

export const BIJLAGEN_BUCKET = 'aanvraag-bijlagen'

export interface Bestand {
  bytes: Uint8Array<ArrayBuffer>
  /** Wat Storage als type teruggeeft; dat is wat de uploader opgaf, dus niet te vertrouwen. */
  mime: string
}

export interface Storage {
  /** Absolute URL met token erin; twee uur geldig. Daar PUT de browser het bestand naartoe. */
  uploadlink(pad: string): Promise<string>
  /** Null als het bestand er niet (meer) is. */
  download(pad: string): Promise<Bestand | null>
}

export function createStorage(url: string, secretKey: string, bucket: string = BIJLAGEN_BUCKET): Storage {
  const sb = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const bak = () => sb.storage.from(bucket)

  return {
    async uploadlink(pad) {
      const { data, error } = await bak().createSignedUploadUrl(pad)
      if (error || !data?.signedUrl) throw new Error(`Uploadlink maken mislukt: ${error?.message ?? 'geen url'}`)
      // In elke versie tot nu toe is dit een absolute URL; mocht dat ooit een pad worden, dan maken
      // we hem hier alsnog compleet in plaats van een kapotte link aan de browser te geven.
      return data.signedUrl.startsWith('http') ? data.signedUrl : `${url.replace(/\/$/, '')}/storage/v1${data.signedUrl}`
    },

    async download(pad) {
      const { data, error } = await bak().download(pad)
      if (error || !data) return null
      return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || 'application/octet-stream' }
    },
  }
}
