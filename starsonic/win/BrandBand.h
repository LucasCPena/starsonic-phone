#pragma once
// Faixa superior com a cor e o logo da Starsonic e a linha de status (spec 6.2, tema B).

class CmainDlg;

class CStarsonicBrandBand : public CStatic {
public:
    void SetStatus(const CString& text);   // SetWindowText + repintura

protected:
    virtual void DrawItem(LPDRAWITEMSTRUCT drawItem);
};
