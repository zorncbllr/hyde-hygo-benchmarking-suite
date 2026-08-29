import numpy as np

# All benchmark functions from HyGO paper Table 2
# Each returns scalar cost (to minimize)

def ackley(x):
    n = len(x)
    a = -20 * np.exp(-0.2 * np.sqrt(np.mean(x**2)))
    b = -np.exp(np.mean(np.cos(2 * np.pi * x)))
    return a + b + np.e + 20

def sphere(x):
    return np.sum(x**2)

def rastrigin(x):
    n = len(x)
    return 10 * n + np.sum(x**2 - 10 * np.cos(2 * np.pi * x))

def rosenbrock(x):
    return np.sum(100 * (x[1:] - x[:-1]**2)**2 + (x[:-1] - 1)**2)

def styblinski_tang(x):
    return 0.5 * np.sum(x**4 - 16*x**2 + 5*x)

def beale(x):
    x1, x2 = x[0], x[1]
    return ((1.5 - x1 + x1*x2)**2 +
            (2.25 - x1 + x1*x2**2)**2 +
            (2.625 - x1 + x1*x2**3)**2)

def booth(x):
    x1, x2 = x[0], x[1]
    return (x1 + 2*x2 - 7)**2 + (2*x1 + x2 - 5)**2

def bukin(x):
    x1, x2 = x[0], x[1]
    return 100 * np.sqrt(abs(x2 - 0.01*x1**2)) + 0.01*abs(x1 + 10)

def easom(x):
    x1, x2 = x[0], x[1]
    return -np.cos(x1)*np.cos(x2)*np.exp(-((x1-np.pi)**2 + (x2-np.pi)**2))

def eggholder(x):
    x1, x2 = x[0], x[1]
    return (-(x2+47)*np.sin(np.sqrt(abs(x1/2 + (x2+47))))
            - x1*np.sin(np.sqrt(abs(x1 - (x2+47)))))

def goldstein_price(x):
    x1, x2 = x[0], x[1]
    a = 1 + (x1+x2+1)**2*(19 - 14*x1 + 3*x1**2 - 14*x2 + 6*x1*x2 + 3*x2**2)
    b = 30 + (2*x1-3*x2)**2*(18 - 32*x1 + 12*x1**2 + 48*x2 - 36*x1*x2 + 27*x2**2)
    return a * b

def himmelblau(x):
    x1, x2 = x[0], x[1]
    return (x1**2 + x2 - 11)**2 + (x1 + x2**2 - 7)**2

def holder_table(x):
    x1, x2 = x[0], x[1]
    return -abs(np.sin(x1)*np.cos(x2)*np.exp(abs(1 - np.sqrt(x1**2+x2**2)/np.pi)))

def levi(x):
    x1, x2 = x[0], x[1]
    return (np.sin(3*np.pi*x1)**2
            + (x1-1)**2*(1+np.sin(3*np.pi*x2)**2)
            + (x2-1)**2*(1+np.sin(2*np.pi*x2)**2))

def matyas(x):
    x1, x2 = x[0], x[1]
    return 0.26*(x1**2 + x2**2) - 0.48*x1*x2

# Global optima for convergence checking (within tolerance)
GLOBAL_OPTIMA = {
    'ackley':          0.0,
    'sphere':          0.0,
    'rastrigin':       0.0,
    'rosenbrock':      0.0,
    'styblinski_tang': None,  # -39.1661 per dim, checked separately
    'beale':           0.0,
    'booth':           0.0,
    'bukin':           0.0,
    'easom':          -1.0,
    'eggholder':    -959.6407,
    'goldstein_price': 3.0,
    'himmelblau':      0.0,
    'holder_table':  -19.2085,
    'levi':            0.0,
    'matyas':          0.0,
}

BOUNDS = {
    'ackley':          (-5, 5),
    'sphere':          (0, 2),
    'rastrigin':       (-5.12, 5.12),
    'rosenbrock':      (-5, 5),
    'styblinski_tang': (-5, 5),
    'beale':           (-4.5, 4.5),
    'booth':           (-10, 10),
    'bukin':           None,  # special bounds
    'easom':           (-100, 100),
    'eggholder':       (-512, 512),
    'goldstein_price': (-2, 2),
    'himmelblau':      (-6, 6),
    'holder_table':    (-10, 10),
    'levi':            (-10, 10),
    'matyas':          (-10, 10),
}

FUNCTIONS = {
    'ackley': ackley,
    'sphere': sphere,
    'rastrigin': rastrigin,
    'rosenbrock': rosenbrock,
    'styblinski_tang': styblinski_tang,
    'beale': beale,
    'booth': booth,
    'bukin': bukin,
    'easom': easom,
    'eggholder': eggholder,
    'goldstein_price': goldstein_price,
    'himmelblau': himmelblau,
    'holder_table': holder_table,
    'levi': levi,
    'matyas': matyas,
}

def get_bounds(fname, dim):
    if fname == 'bukin':
        lo = np.array([-15, -3])
        hi = np.array([-5, 3])
    else:
        b = BOUNDS[fname]
        lo = np.full(dim, b[0])
        hi = np.full(dim, b[1])
    return lo, hi

def converged(fname, best_cost, dim, tol=1e-4):
    opt = GLOBAL_OPTIMA[fname]
    if opt is None:  # styblinski_tang
        opt = -39.16617 * dim
    return abs(best_cost - opt) < tol