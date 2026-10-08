# PotLuck

Team Thanksgiving potluck sign-up sheet.

A sign-up sheet for a company-wide potluck. It has:

- **Three shifts.** Morning, Swing and Graveyard each have their own spread. Graveyard is the default.
- **A preset Thanksgiving list.** Each dish has a count per shift ("Mac & cheese 2/5"). A dish gets crossed off when it fills.
- **Write-ins.** People can add a dish that isn't on the list.
- **Sign-up details.** Each sign-up has a name and department, plus optional specifics, servings, dietary tags and a **recipe, link or deal** that others can open.
- **Editing your own sign-up.** People can edit or cancel their own sign-up from the same phone or computer. No accounts needed.
- **A sign-in page** in front of the whole site. Everyone uses one shared username and password (set in Render), so only your team can see the sheet.
- **A QR code** on the admin page that opens the sign-up sheet, with a download button and a printable flyer (`/flyer`) for the break room.
- **An admin page at `/admin`.** It's password protected and shows a full roster with search and filters, what's still needed per shift, and a CSV download. From there you can also edit the event, add, remove or resize dishes, and remove any sign-up.

The site runs on **Render** and stores sign-ups in **Supabase** (Postgres). It creates its own tables the first time it starts.

---

## 1. Get the Supabase connection string

1. Open your Supabase project and click **Connect** at the top.
2. Under **Connection string**, choose **Session pooler**. Render's free plan needs this one; the "Direct connection" won't work there.
3. Copy it. It looks like
   `postgresql://postgres.abcdxyz:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres`
4. Replace `[YOUR-PASSWORD]` with your database password. If the password has symbols like `@ # / ?`, either reset it to letters and numbers, or URL-encode those characters (`@` becomes `%40`).

## 2. Put the code on GitHub

Create a new repository (it can be private) and upload everything in this folder **except** `node_modules`.

## 3. Deploy on Render

1. In Render, click **New → Blueprint** and pick your repo. Render reads `render.yaml`.
2. It asks for two values:
   - `DATABASE_URL`: the Supabase string from step 1
   - `ADMIN_PASSWORD`: the password you'll use to open the admin page
3. Click **Apply**. When the deploy finishes you'll get a link like `https://potluck-signup.onrender.com`.

(If you'd rather not use a Blueprint, use **New → Web Service** with build command `npm install` and start command `npm start`. Then add `DATABASE_URL`, `ADMIN_PASSWORD` and `SESSION_SECRET`, which can be any long random text, under **Environment**.)

## 4. Set it up

1. Go to `https://your-link.onrender.com/admin` and log in with your admin password.
2. Click **← Sign-up sheet**, then **Edit date, place & departments**. Fix the department list to match your property.
3. Adjust any dish counts with **−** and **+**, or add dishes.
4. Share the main link (without `/admin`) with everyone.

## Turn on the team login

In Render, open the service, go to **Environment**, and add:

- `SITE_USERNAME`: `Windcreek`
- `SITE_PASSWORD`: the shared password

Save, and Render redeploys. After that, anyone who opens the link or scans the QR code sees the sign-in page first. The username isn't case-sensitive, but the password is. People stay signed in on their phone for 90 days. Changing `SITE_PASSWORD` signs everyone out. The admin page still asks for `ADMIN_PASSWORD` on top of this.

The password is kept in Render rather than in this code because this repository is public.

## Good to know

- **QR code link.** The QR code points to `https://potluck-signup-8oyh.onrender.com/`. If the site's address ever changes, add a `PUBLIC_URL` environment variable in Render with the new address.

- **Free plan sleep.** On Render's free plan, the site sleeps after 15 minutes without visitors. The first person after that waits about a minute for it to load. To avoid that, upgrade the service to a paid instance in Render. The data is safe either way, because it lives in Supabase.
- **The sheet refreshes itself** every 10 seconds, so people see dishes fill up live.
- **Edit and cancel work per device.** "Cancel mine" works on the phone or computer someone signed up from. If they switch devices, you can edit or remove their sign-up from the admin page.
- **Everyone can see the sheet.** Anyone with the link can see who signed up and what they're bringing, just like a paper sheet in the break room. Only the admin page can change the event or remove other people's sign-ups.

## Run it on your own computer (optional)

```
npm install
cp .env.example .env    # fill in the values
node --env-file=.env server.js
```

Then open http://localhost:3000
