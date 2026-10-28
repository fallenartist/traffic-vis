# Wizualizacja 2D — wdrożenie i dalsze możliwości

## Co pokazuje przykład Maptalks

Kod [przykładu trajectories](https://maptalks.org/gallery/trajectories/index.html) tworzy `BigPointLayer` z **615 948 punktów** danych GPS Microsoft Geolife. Punkty mają 2 × 2 piksele, niebieski kolor i przezroczystość 0,3. Ich nakładanie się pokazuje zagęszczenie przebytych tras. Przykład jest statyczny; kod nie animuje ruchu. Warstwa nie wyznacza tras na podstawie samych punktów początkowych i końcowych.

README [maptalks.biglayer](https://github.com/maptalks/maptalks.biglayer) oznacza projekt jako przestarzały i nieutrzymywany. Podaje zgodność wyłącznie z Maptalks starszym niż 0.46.0. Nie ma potrzeby dodawania go do obecnego projektu.

## Dwie możliwości w obecnym stosie

| Rozwiązanie | Sposób prezentacji | Kiedy wybrać |
| --- | --- | --- |
| Natywny Mapbox GL JS | Źródło punktowe i warstwa `circle`: małe punkty, niski `circle-opacity`, kolor zależny od rodzaju ruchu. Opcjonalnie cienka linia pod punktami. | Prosty prototyp i umiarkowane zbiory. Dla dużego zbioru rozważyć kafle wektorowe, aby nie pobierać całego GeoJSON naraz. |
| Three.js we wspólnej warstwie Mapbox | `THREE.Points`, `BufferGeometry` z pozycjami i kolorami, własny shader do miękkich punktów i kontrolowanego nakładania. | Zalecane dla docelowego efektu z setkami tysięcy punktów. Wykorzystuje istniejący renderer; pozycje pozostają na GPU. Płynność trzeba sprawdzić na docelowym urządzeniu. |

Rekomendacja: **Mapbox jako mapa + Three.js Points do gęstej warstwy trajektorii**. Zachować kolory rodzajów transportu, a liczbę punktów/ich zagęszczenie powiązać z natężeniem ruchu. Przybliżenie mapy wpływa na nakładanie punktów, dlatego legenda i normalizacja muszą rozróżniać prezentację zagęszczenia od dokładnych wartości, dostępnych w etykietach.

Animacja jest opcjonalna. Można dodać poruszające się punkty lub krótkie ślady sterowane czasem w shaderze. Przy rzeczywistych znacznikach czasu można odtwarzać pomiary; przy samych sumach przepływów byłaby to animacja poglądowa. Statyczna warstwa powinna zatrzymać renderowanie, gdy mapa się nie zmienia; animowana potrzebuje odświeżania tylko podczas odtwarzania i powinna mieć pauzę oraz obsługę ograniczonego ruchu.

## Trasy po ulicach z Mapbox

**Tak — Mapbox może dostarczyć przebieg trasy pomiędzy punktami.** GL JS wyświetla geometrię, a [Directions API](https://docs.mapbox.com/api/navigation/directions/) ją wyznacza. Parametry `geometries=geojson&overview=full` zwracają szczegółową linię, którą można wykorzystać zarówno w warstwie Mapbox, jak i w buforach Three.js.

* Samochody: profil `mapbox/driving` lub `mapbox/driving-traffic`.
* Rowery: `mapbox/cycling`.
* Piesi: `mapbox/walking`.
* Autobusy: rzeczywista geometria linii, np. z `shapes.txt` w danych GTFS, jest lepsza od przybliżenia trasą samochodową. Directions nie oferuje osobnego profilu komunikacji miejskiej w udokumentowanym zestawie profili.

Z samych końców połączenia otrzymamy trasę sugerowaną przez silnik routingu; nie ustalimy w ten sposób faktycznie przebytej trasy. Dla śladów GPS służy [Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/), które dopasowuje pomiary do sieci dróg i ścieżek.

Trasy wyznacza się raz przy przygotowaniu/zmianie danych, z pamięcią podręczną zgodną z warunkami usługi, a nie co klatkę. Directions i Map Matching to oddzielne usługi API z rozliczaniem opisanym w ich dokumentacji. Nie zostały wywołane w ramach tej propozycji.

## Wdrożenie w obecnej wersji

Wdrożono wariant **Mapbox + Three.js Points**: statyczne chmury półprzezroczystych punktów wzdłuż prostych odcinków, z kolorem rodzaju transportu i liczbą punktów proporcjonalną do wartości przepływu. Dane pozostają przykładowe; nie są to ślady GPS ani trasy po ulicach.

Obecny zbiór tworzy 130 768 punktów w czterech buforach. Dla dużych danych wspólny budżet wynosi 250 000 punktów. Pozycje są deterministyczne; zmiana filtrów aktualizuje przezroczystość, bez ponownego losowania geometrii. Punkty są miękkie, mają 2,4 piksela CSS i bazową alfę 0,28. Nieaktywne przepływy zachowują kolor przy 12% bazowej alfy. Nie dodano animacji ani wywołań usług routingu.

Interfejs pozostał minimalny: przełącznik 3D/2D, rodzaj ruchu i lokalizacja. Dokładne liczby są w etykietach pod kursorem oraz panelu bocznym. Zagęszczenie punktów daje jakościowy obraz przepływów; nakładanie przezroczystości nie jest liniową skalą natężenia.

Dalszy krok, jeśli będzie potrzebny: zastąpić proste odcinki geometrią z Directions lub dostarczonymi śladami. Mechanizm prezentacji punktowej można zachować. Animację można rozważyć osobno po określeniu znaczenia czasu w danych.

Źródła: [kod przykładu Maptalks](https://maptalks.org/gallery/trajectories/index.html), [README biglayer](https://github.com/maptalks/maptalks.biglayer), [Mapbox: animacja punktu na trasie](https://docs.mapbox.com/mapbox-gl-js/example/animate-point-along-route/), [Mapbox: warstwa circle](https://docs.mapbox.com/style-spec/reference/layers/#circle), [Three.js Points](https://threejs.org/docs/pages/Points.html), [GTFS shapes.txt](https://gtfs.org/documentation/schedule/reference/#shapestxt).
