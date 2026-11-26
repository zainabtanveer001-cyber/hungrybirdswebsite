/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./admin.html",
    "./google-maps-embed.html",
    "./appwebsite.js",
    "./adminwebsite.js",
    "./ai-assistant.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Bricolage Grotesque"', '"Plus Jakarta Sans"', 'sans-serif']
      },
      colors: {
        brand: {
          red: '#C62822',
          redDark: '#9F1D18',
          redSoft: '#FDF2F1',
          espresso: '#231711',
          espressoDark: '#1A120E',
          muted: '#5C493F',
          gold: '#E8A838',
          goldDark: '#8A5600',
          goldSoft: '#FEF7E6',
          coral: '#E86F3A',
          cream: '#FAF7F2',
          sand: '#EFE7DC'
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(35, 23, 17, 0.08)",
        glow: "0 10px 28px rgba(198, 40, 34, 0.24)"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(0, -10px, 0)" }
        },
        pulseSoft: {
          "0%, 100%": { transform: "scale(1)", opacity: ".55" },
          "50%": { transform: "scale(1.08)", opacity: ".85" }
        }
      },
      animation: {
        float: "float 5s ease-in-out infinite",
        "pulse-soft": "pulseSoft 4s ease-in-out infinite"
      }
    }
  },
  plugins: []
}
