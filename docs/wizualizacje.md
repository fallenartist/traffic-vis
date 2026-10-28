# Wizualizacje przepływów ruchu

Aplikacja przedstawia kierunki i natężenie ruchu między punktami w Gliwicach w dwóch widokach: jako przestrzenne wstęgi Sankeya oraz jako płaską chmurę punktów. Oba widoki korzystają z tych samych danych, kolorów i filtrów. Przełączenie widoku zmienia sposób prezentacji, bez zmiany wartości przepływów.

## Dane i ich znaczenie

Sieć obejmuje siedem lokalizacji, jedenaście skierowanych połączeń oraz 44 przepływy — po jednym dla każdego rodzaju transportu na każdym połączeniu. Każdy przepływ określa punkt początkowy, punkt końcowy, rodzaj transportu i dodatnią, całkowitą wartość.

| Rodzaj ruchu | Kolor | Jednostka |
| --- | --- | --- |
| Samochody | Czerwony `#ff3355` | Pojazdy |
| Autobusy | Niebieski `#3395ff` | Pojazdy, bez przeliczania na pasażerów |
| Rowery | Zielony `#00e676` | Rowery |
| Piesi | Żółty `#ffce00` | Osoby |

**Dane są przykładowe i nie pochodzą z pomiarów.** Nie określono okresu obserwacji, więc wartości nie oznaczają ruchu na godzinę ani na dobę. Wartości poszczególnych rodzajów transportu są prezentowane oddzielnie.

### Zamknięty obieg

W każdym punkcie napływ jest równy odpływowi dla każdego rodzaju ruchu. Dotyczy to również Rynku i Trynku. Bilans w Rynku i Trynku wynosi po 1000 samochodów, 500 autobusów, 300 rowerów i 200 pieszych na wejściu oraz na wyjściu.

Wartości rozdzielane są między kolejne połączenia proporcjonalnie do wag zapisanych przy lokalizacjach. Zaokrąglanie metodą największych reszt zachowuje całkowite liczby oraz ich sumy. Dodatkowe połączenie **Trynek → Rynek** zamyka obieg, dostarczając do Rynku dokładnie tyle ruchu, ile z niego odpływa. Wygenerowany zbiór przechodzi kontrolę zgodności napływu i odpływu we wszystkich punktach.

Sumy dla całej sieci obejmują przemieszczenia na poszczególnych połączeniach. Nie są liczbą unikalnych podróży: przejazd przez kilka połączeń jest uwzględniony na każdym z nich. Także zamknięcie obiegu jest elementem modelu demonstracyjnego, a nie informacją o rzeczywistych trasach mieszkańców.

## Widok 3D — wstęgi Sankeya

### Wysokość i układ kolorów

Wysokość wstęgi jest proporcjonalna do wartości przepływu. Wszystkie połączenia korzystają ze wspólnej skali: **jedna jednostka przepływu odpowiada 0,6 m wysokości**, czyli 100 jednostek zajmuje 60 m. To umowna skala wizualizacji, a nie fizyczna wysokość ruchu nad miastem.

Każdy rodzaj transportu zajmuje w danym punkcie jeden wspólny przedział wysokości. Przedziały ułożone są kolejno: samochody, autobusy, rowery, piesi. Napływ i odpływ tego samego rodzaju ruchu mają w punkcie takie same granice wysokości.

Przykładowo trzy samochodowe przepływy o wartościach 200, 300 i 500 wypełniają sąsiadujące fragmenty jednego przedziału o łącznej wysokości 600 m. Nie tworzą trzech osobnych zestawów kolorów na różnych poziomach. Poza punktem fragmenty mogą rozchodzić się pionowo, a przed kolejnym punktem wracają do przedziału swojego koloru. Każda pojedyncza wstęga zachowuje taką samą grubość na obu końcach.

### Przebieg krzywych i połączenia przy masztach

Planarny przebieg wstęg opiera się na sześciennych krzywych Béziera. Uchwyty krzywych są skierowane zgodnie z wybranymi kierunkami wejścia i wyjścia; ich długość odpowiada połowie odległości między punktami.

Przy obu końcach występuje krótki, prosty odcinek o stałej wysokości. Ma długość 55 m, ograniczoną do 15% odległości między bardzo bliskimi punktami. W trybie wspólnej osi pozwala on zebrać wszystkie pasma napływające przed masztem i utrzymać pełny stos kolorów tuż za nim. Dalej wstęgi płynnie rozdzielają się pionowo i zbierają w zwarte pasma danego połączenia.

Krzywe przedstawiają schematyczne połączenia między lokalizacjami. **Nie odwzorowują przebiegu ulic.**

### Dwa sposoby wyznaczania kierunków

Interfejs udostępnia wyłącznie wybór widoku 3D lub 2D. Wstęgi korzystają automatycznie z rozłącznych kierunków opisanych poniżej. Alternatywny tryb wspólnej osi pozostaje w kodzie, bez przełącznika w panelu bocznym.

**Do celu 45° / auto — tryb domyślny.** Każde skierowane połączenie otrzymuje przy danym punkcie osobny kierunek. Przydział uwzględnia napływ i odpływ razem, dzięki czemu nie zajmują przypadkowo tego samego kierunku. Cztery kolory należące do jednego połączenia pozostają razem; nie są traktowane jako cztery osobne kierunki.

Algorytm dobiera wolne kierunki tak, aby zminimalizować sumę kwadratów odchyleń kątowych od położenia pozostałych końców połączeń. Gdy najbliższy kierunek jest już zajęty, inne połączenie otrzymuje sąsiednią wolną pozycję. Wynik jest niezależny od kolejności rekordów danych.

| Liczba połączeń przy punkcie, łącznie z napływem i odpływem | Odstęp kierunków |
| --- | --- |
| Do 8 | 45° |
| 9–12 | 30° |
| 13–24 | 15° |
| Powyżej 24 | Dalszy podział: 7,5°, 3,75° itd. |

Połączenia w przeciwnych kierunkach między tą samą parą punktów otrzymują oddzielne pozycje.

**Wspólna oś.** Jeden kierunek osi dopasowywany jest do wszystkich sąsiadów punktu, z uwzględnieniem wielkości przepływów. Dopasowanie metodą najmniejszych kwadratów pozostaje stabilne także wtedy, gdy sąsiedzi leżą po przeciwnych stronach. Wszystkie odpływy wychodzą po jednej stronie masztu, a napływy zbierają się po przeciwnej. Ten tryb celowo utrzymuje wspólną oś dla wielu połączeń.

Zmiana trybu kierunków wpływa na geometrię krzywych, ale nie zmienia danych, grubości pasm ani wysokości masztów.

### Budynki, maszty i etykiety

Cała sieć wstęg zaczyna się co najmniej 30 m nad poziomem odniesienia mapy i jest podnoszona jednolicie, tak aby zachować przynajmniej 20 m zapasu nad rozpoznanymi budynkami z załadowanych danych. Podczas przesuwania mapy poziom może wzrosnąć po wykryciu wyższego budynku; nie obniża się automatycznie.

Odczyt wysokości obsługuje standardowe pola wysokości budynków Mapbox oraz stałe wysokości warstw wyciągniętych brył. Niestandardowe modele i inne wyrażenia wysokości mogą wymagać osobnej obsługi.

Maszty pozostają zakotwiczone przy powierzchni mapy i sięgają 35 m ponad stos wstęg. Płaskie etykiety z samą nazwą miejsca są umieszczone na ich końcach i przesuwają się razem z nimi po zmianie poziomu sieci.

## Widok 2D — zagęszczenie punktów

Widok 2D wykorzystuje `Three.js Points`: niewielkie, miękkie, półprzezroczyste punkty rozmieszczone wzdłuż prostych połączeń między lokalizacjami. Kolor określa rodzaj transportu, a liczba punktów jest proporcjonalna do wartości przepływu. Delikatne przesunięcia boczne tworzą chmurę i pomagają rozdzielić kolory; przy końcach strumienie zbiegają się w punktach mapy.

To **schematyczne zagęszczenie modelowanych przemieszczeń**, a nie rzeczywiste ślady GPS. Widok jest statyczny i nie przedstawia ruchu w czasie.

### Skala i ograniczenie liczby punktów

- Dla obecnych danych przypada 16 punktów na jednostkę przepływu, co daje **130 768 punktów**.
- Wspólny limit dla większych zbiorów wynosi **250 000 punktów**. Po jego przekroczeniu punkty są rozdzielane proporcjonalnie między przepływy. Ograniczenie nie zmienia wartości danych.
- Średnica punktu wynosi 2,4 piksela CSS, z uwzględnieniem gęstości pikseli ekranu. Bazowa wartość alfa wynosi 0,28.
- Rozmieszczenie jest deterministyczne. Przełączanie filtrów nie losuje punktów ponownie.

Nakładanie półprzezroczystych punktów uwidacznia zagęszczenie, ale efekt jasności nie jest liniowy. Na wygląd wpływa także przybliżenie mapy. Dokładne wartości należy odczytywać z informacji pod kursorem i panelu bocznego. Etykiety miejsc w tym widoku znajdują się przy powierzchni mapy.

## Wybór przepływów i odczyt wartości

W obu widokach można wybrać rodzaj transportu oraz lokalizację. Aktywne przepływy zachowują normalną widoczność, a pozostałe pozostają w swoim kolorze przy **12% bazowej wartości alfa**. Wygaszenie zmienia przezroczystość, bez przyciemniania samego koloru.

Najazd kursorem pokazuje początek, koniec i wartość przepływu. Wybór miejsca wyświetla napływ i odpływ według rodzaju transportu. Tabela połączeń oraz eksport JSON uwzględniają bieżące filtry. Wyeksportowany fragment sieci nie musi być zbilansowany przy pozostałych punktach; metadane odróżniają go od pełnego, zamkniętego obiegu.

## Sposób renderowania i wydajność

Mapbox wyświetla podkład mapy, a Three.js renderuje wizualizacje we wspólnym kontekście WebGL. Wstęgi są grupowane w cztery siatki, po jednej na rodzaj transportu. Widok punktowy również korzysta z czterech grup, współdzielących jedną proceduralną teksturę miękkiego punktu. Maszty stanowią dodatkową grupę linii.

Geometria jest przechowywana osobno dla obu wariantów 3D i widoku 2D. Filtry aktualizują przezroczystość istniejących buforów. Aplikacja nie ma ciągłej pętli animacji: nieruchoma, załadowana mapa nie wymusza kolejnych klatek. Zasoby graficzne są zwalniane przy usuwaniu mapy.

W widoku 2D wskazywanie przepływu sprawdza środki połączeń, zamiast przeszukiwać wszystkie punkty chmury. Funkcja `trafficDebug()` w konsoli przeglądarki udostępnia liczbę klatek, wywołań rysowania, punktów, geometrii oraz bieżące ustawienia. Nie ustalono porównawczego wyniku FPS dla urządzeń docelowych.

## Pliki implementacji

- [Dane i kontrola bilansu](../src/data.js)
- [Geometria wstęg i masztów](../src/geometry.js)
- [Przydział rozłącznych kierunków](../src/bearings.js)
- [Chmury punktów 2D](../src/trajectories.js)
- [Odstęp nad budynkami](../src/elevation.js)
- [Integracja mapy, interakcje i filtry](../src/main.js)
